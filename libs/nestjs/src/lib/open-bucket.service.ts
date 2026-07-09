import { Inject, Injectable, Optional } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { InjectMikroORM } from '@mikro-orm/nestjs';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';

import { AppConfigService } from './common/config/app-config.service';
import { BucketService } from './domain/buckets/bucket.service';
import { ObjectService } from './domain/objects/object.service';
import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from './open-bucket-options';
import { OPEN_BUCKET_ORM_CONTEXT } from './persistence/orm-context';
import { NoSuchKeyError } from './s3/errors/s3-error';
import { buildPresignedUrl, MAX_EXPIRES } from './s3/sigv4/presigned';
import { buildPresignedPost } from './s3/sigv4/presigned-post';
import { SNIFF_BYTES, sniffContentType } from './storage/content-sniff';
import { imageInfo, type ImageInfo } from './storage/image-info';
import {
  assertValid,
  resolveContentType,
  resolveKey,
  sanitizeFilename,
  type KeyStrategy,
  type KeyStrategyContext,
  type UploadValidateOptions,
} from './open-bucket-upload';

/** Result of an in-process object write. */
export interface PutObjectResult {
  etag: string;
  /** Present on versioning-enabled buckets. */
  versionId?: string;
}

/**
 * A structural subset of a multer (`Express.Multer.File`) upload — enough for
 * {@link OpenBucketService.uploadFrom} to consume both memory-storage (`buffer`)
 * and disk/stream-storage files without a hard `@types/multer` dependency.
 */
export interface MulterFileLike {
  /** Memory-storage body. */
  buffer?: Buffer;
  /** Disk/stream-storage body. */
  stream?: Readable;
  /** Declared MIME type (used as the fallback content-type hint). */
  mimetype?: string;
  /** Original client filename (hint for the `'original'` key strategy / extension). */
  originalname?: string;
  /** Byte length, when known (multer sets it for disk storage). */
  size?: number;
}

/** Accepted upload body for {@link OpenBucketService.uploadFrom}. */
export type UploadSource = Buffer | Readable | MulterFileLike;

/** Options for {@link OpenBucketService.uploadFrom}. */
export interface UploadOptions {
  /** Destination bucket. */
  bucket: string;
  /** Explicit key — wins over `keyStrategy`. */
  key?: string;
  /** Key-generation strategy. Default `'uuid'`. */
  keyStrategy?: KeyStrategy;
  /** Declarative validation (size cap, allowlist, active-content, sniff mode). */
  validate?: UploadValidateOptions;
  /** Declared content-type hint (a multer `mimetype` is used when omitted). */
  contentType?: string;
  /** Filename hint for the `'original'` strategy / extension (multer `originalname` used when omitted). */
  filename?: string;
  /**
   * Arbitrary user metadata persisted with the object and returned by
   * {@link OpenBucketService.headObject} (`userMetadata`).
   */
  userMetadata?: Record<string, string>;
  /** Probe image dimensions. Default: auto for `image/*` resolved types. */
  image?: boolean;
  /** Mint a GET url; default: mint iff an origin (`baseUrl`/`endpoint`) is resolvable. `false` disables. */
  presign?: PresignOptions | false;
}

/**
 * The canonical shape of an object committed through OpenBucket's upload path —
 * the stable `{ bucket, key, url?, etag, size, contentType, versionId?, image? }`
 * you should persist. Returned by {@link OpenBucketService.uploadFrom}, merged
 * onto the multer file by the `@openbucket/nestjs/multer` storage engine
 * (`OpenBucketMulterInfo`), and handed to a handler by `@UploadedToBucket()`
 * (`UploadedFileInfo`) — those two names are aliases of this one type.
 *
 * Carries no secret: `contentType` is the RESOLVED (sniffed) type — never the
 * client's unverified claim — and `url`, when present, is a short-lived presigned
 * GET url.
 */
export interface UploadedObject {
  bucket: string;
  key: string;
  /** Present when an origin was resolvable (or `presign.baseUrl` was given). */
  url?: string;
  etag: string;
  size: number;
  /** The RESOLVED content type (sniffed over declared). */
  contentType: string;
  /** Present on versioning-enabled buckets. */
  versionId?: string;
  /** Present when the body was probed as an image. */
  image?: ImageInfo;
}

/** Result of {@link OpenBucketService.uploadFrom}. Alias of {@link UploadedObject}. */
export type UploadResult = UploadedObject;

/** One object (or rolled-up prefix) in a listing. */
export interface ObjectListEntry {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  storageClass: string;
}

/** One page of an object listing. */
export interface ObjectListResult {
  contents: ObjectListEntry[];
  /** Keys rolled up under `delimiter`. */
  commonPrefixes: string[];
  /** Pass back as `marker` to fetch the next page. */
  nextMarker?: string;
  isTruncated: boolean;
}

/** Object metadata (no body). */
export interface ObjectInfo {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  lastModified: Date;
  versionId?: string;
  userMetadata?: Record<string, string>;
}

/** A bucket and when it was created. */
export interface BucketInfo {
  name: string;
  createdAt: Date;
}

/** Options for {@link OpenBucketService.createBucket}. */
export interface CreateBucketOptions {
  /** Enable object versioning at creation. Default `false`. */
  versioning?: boolean;
  /** Enable S3 object lock at creation. Default `false`. */
  objectLock?: boolean;
}

/** Options for {@link OpenBucketService.putObject}. */
export interface PutObjectOptions {
  /** Declared content type stored with the object. Default `application/octet-stream`. */
  contentType?: string;
  /**
   * Arbitrary user metadata persisted with the object and returned by
   * {@link OpenBucketService.headObject} (`userMetadata`). Keys/values are stored
   * verbatim.
   */
  userMetadata?: Record<string, string>;
}

/** Options for {@link OpenBucketService.listObjects}. */
export interface ListObjectsOptions {
  /** Only keys under this prefix. */
  prefix?: string;
  /** Roll keys up into `commonPrefixes` at this delimiter (folder-style browsing). */
  delimiter?: string;
  /** Pagination cursor — pass back the previous page's `nextMarker`. */
  marker?: string;
  /** Max keys per page (hard-capped at 1000). Default 1000. */
  limit?: number;
}

/**
 * A single S3 POST-policy condition (AWS-compatible forms) — the escape-hatch
 * `conditions` on {@link PresignPostOptions}. Re-homed here (from the internal
 * SigV4 crypto module) so the public export is not coupled to an internal file
 * path; the crypto core imports this same type back.
 */
export type PostPolicyCondition =
  | Record<string, string> // exact match: { key: 'uploads/a.png' }
  | ['eq', string, string] // ['eq', '$key', 'uploads/a.png']
  | ['starts-with', string, string] // ['starts-with', '$key', 'uploads/']
  | ['content-length-range', number, number];

/** Options for minting a presigned browser POST (direct upload form). */
export interface PresignPostOptions {
  /** Object key. May contain the literal `${filename}` placeholder. */
  key: string;
  /** Lifetime in seconds (1 … 7 days). Default 900. */
  expiresIn?: number;
  /** Public origin (scheme + host); defaults to `endpoint` like the other presign methods. */
  baseUrl?: string;
  /** Restrict the accepted byte size of the uploaded file. */
  contentLengthRange?: { min: number; max: number };
  /** Pin (`string`) or prefix-restrict (`{ startsWith }`) the content type. */
  contentType?: string | { startsWith: string };
  /** `starts-with` the key instead of an exact match (folder-scoped upload tokens). */
  keyStartsWith?: boolean;
  /** Extra raw conditions passed straight through (escape hatch). */
  conditions?: PostPolicyCondition[];
  successActionStatus?: '200' | '201' | '204';
  successActionRedirect?: string;
}

/** A minted browser-POST form: `url` to POST to, plus the hidden `fields`. */
export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

/** Options for minting a presigned URL. */
export interface PresignOptions {
  /** Lifetime in seconds (1 … 7 days). Default 900 (15 min). */
  expiresIn?: number;
  /**
   * Public origin clients will use, scheme + host only — e.g.
   * `https://files.example.com` or `http://localhost:3000`. The bucket/key (and
   * the configured `mountPath`) are appended for you. Defaults to the `endpoint`
   * option (over https) when set; otherwise required.
   */
  baseUrl?: string;
}

/**
 * In-process facade over OpenBucket's object store — the host-app-facing API of
 * `@openbucket/nestjs`. Inject it anywhere in your NestJS app to upload, read,
 * list, and delete objects and manage buckets without an HTTP round-trip, plus
 * mint presigned URLs for direct browser up/downloads.
 *
 * Every data method runs inside a MikroORM `RequestContext` for OpenBucket's
 * named ORM (its EM forbids the global context), so these are safe to call from
 * places with no per-request context — services, cron jobs, queue consumers,
 * `OnApplicationBootstrap`, etc. Presign methods are pure crypto over the root
 * credentials and touch neither the DB nor the filesystem.
 *
 * Errors are OpenBucket's S3 domain errors (e.g. `NoSuchBucketError`,
 * `NoSuchKeyError`) — catch them, or check first with {@link bucketExists} /
 * {@link headObject}.
 */
@Injectable()
export class OpenBucketService {
  constructor(
    @InjectMikroORM(OPEN_BUCKET_ORM_CONTEXT) private readonly orm: MikroORM,
    private readonly objects: ObjectService,
    private readonly buckets: BucketService,
    private readonly config: AppConfigService,
    // Library mode provides the resolved options (for `mountPath`); the standalone
    // app does not (it mounts at the root, so `mountPath` is '').
    @Optional() @Inject(OPEN_BUCKET_OPTIONS) private readonly options?: ResolvedOpenBucketOptions,
  ) {}

  private get mountPath(): string {
    return this.options?.mountPath ?? '';
  }

  /** Run `fn` inside a fresh RequestContext for the named ORM. */
  private async withContext<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T;
    await RequestContext.create(this.orm.em, async () => {
      result = await fn();
    });
    return result;
  }

  // ---- Buckets --------------------------------------------------------

  /** List all buckets. */
  listBuckets(): Promise<BucketInfo[]> {
    return this.withContext(async () => {
      const rows = await this.buckets.listWithStats();
      return rows.map((b) => ({ name: b.name, createdAt: b.createdAt }));
    });
  }

  /** True if the bucket exists. */
  bucketExists(name: string): Promise<boolean> {
    return this.withContext(async () => (await this.buckets.findByName(name)) !== null);
  }

  /**
   * Create a bucket. Throws `BucketAlreadyOwnedByYouError` if it already exists.
   * Set `versioning`/`objectLock` to enable those features at creation.
   */
  createBucket(name: string, opts: CreateBucketOptions = {}): Promise<void> {
    return this.withContext(async () => {
      await this.buckets.create({
        name,
        versioning: opts.versioning ? 'enabled' : 'disabled',
        objectLock: opts.objectLock ?? false,
        region: this.config.region,
      });
    });
  }

  /** Delete an (empty) bucket. Throws `NoSuchBucketError` / `BucketNotEmptyError`. */
  deleteBucket(name: string): Promise<void> {
    return this.withContext(() => this.buckets.deleteByName(name));
  }

  // ---- Objects --------------------------------------------------------

  /**
   * Upload (or overwrite) an object. `body` may be a `Buffer`, string, or a
   * readable stream (large uploads stream straight to disk). Throws
   * `NoSuchBucketError` if the bucket is absent.
   */
  putObject(
    bucket: string,
    key: string,
    body: Readable | Buffer | string,
    opts: PutObjectOptions = {},
  ): Promise<PutObjectResult> {
    const stream = body instanceof Readable ? body : Readable.from(body);
    return this.withContext(() =>
      this.objects.putFromStream(bucket, key, stream, opts.contentType, undefined, opts.userMetadata),
    );
  }

  /**
   * One-call upload helper (STORY-0803): sniffs the real content type from the
   * body's magic bytes, enforces size/type/active-content validation, derives a
   * safe key, streams the body through the same two-phase writer `putObject`
   * uses, optionally probes image dimensions, and (when an origin is resolvable)
   * mints a GET url — returning the stable `{ bucket, key, etag, size,
   * contentType, … }` you should persist.
   *
   * Accepts a multer file (`{ buffer | stream, mimetype, originalname, size }`),
   * a `Readable`, or a `Buffer`; a stream is never fully buffered (only a bounded
   * `SNIFF_BYTES` head is held). The byte cap is enforced two ways: pre-write for
   * known-size sources and mid-write via the writer's `maxSize` for streams (an
   * oversize stream aborts and its staged blob is unlinked — no object committed).
   *
   * Security: the sniffed type wins over the caller-declared type and active
   * content (HTML/XHTML/SVG) is rejected by default — defense in depth for the
   * stored-XSS surface `applySafeObjectResponseHeaders` also guards on read.
   * `uploadFrom`, like `putObject`, is the in-process host-app facade and sits
   * *inside* the SigV4 + policy perimeter (EPIC-08); it adds no network surface
   * and is not rate-limited by the wire throttle — host apps own request-level
   * authz / limits for their own routes.
   *
   * Throws `UploadValidationError` (map its `statusHint` 400 to a
   * `BadRequestException`) on a rejected upload, or `NoSuchBucketError` if the
   * bucket is absent.
   */
  async uploadFrom(source: UploadSource, opts: UploadOptions): Promise<UploadResult> {
    const norm = normalizeUploadSource(source);
    const mode = opts.validate?.sniffContentType ?? 'prefer';
    const maxBytes = opts.validate?.maxBytes ?? this.config.maxObjectSizeMb * 1024 * 1024;

    return this.withContext(async () => {
      const { head, stream } = await this.peekHead(norm.body, SNIFF_BYTES);

      const sniffed = sniffContentType(head);
      const declared = opts.contentType ?? norm.declared;
      const resolvedType = resolveContentType(declared, sniffed, mode);

      const wantImage = opts.image ?? resolvedType.startsWith('image/');
      const image = wantImage ? imageInfo(head) : undefined;

      // Early reject before any write for known-size sources; the stream path's
      // byte cap is enforced by the writer's maxSize below.
      assertValid(resolvedType, norm.knownSize, { ...(opts.validate ?? {}), maxBytes });

      const filename = opts.filename ?? norm.filename;
      const ext = sanitizeFilename(filename).ext;
      const strategy = opts.keyStrategy ?? 'uuid';
      const ctx: KeyStrategyContext = { filename, contentType: resolvedType, ext };
      const meta = opts.userMetadata;

      let key: string;
      let write: { etag: string; versionId?: string; size: number; sha256?: string };

      if (opts.key) {
        key = opts.key;
        write = await this.objects.putFromStream(opts.bucket, key, stream, resolvedType, maxBytes, meta);
      } else if (strategy === 'sha256' && Buffer.isBuffer(norm.body)) {
        // Content-addressed, buffer fast path: hash directly, write once.
        const sha256 = createHash('sha256').update(norm.body).digest('hex');
        key = resolveKey('sha256', { ...ctx, sha256 });
        write = await this.objects.putFromStream(opts.bucket, key, stream, resolvedType, maxBytes, meta);
      } else if (strategy === 'sha256') {
        // Content-addressed, stream path: the digest is only known post-write, so
        // stage under a temp key, then relocate to the digest key (idempotent on
        // repeat — identical content lands on the same key).
        const staged = await this.uploadShaFromStream(
          opts.bucket,
          stream,
          resolvedType,
          maxBytes,
          ctx,
          meta,
        );
        key = staged.key;
        write = staged;
      } else {
        key = resolveKey(strategy, ctx);
        write = await this.objects.putFromStream(opts.bucket, key, stream, resolvedType, maxBytes, meta);
      }

      const url = this.resolveUploadUrl(opts.bucket, key, opts.presign);

      const result: UploadResult = {
        bucket: opts.bucket,
        key,
        etag: write.etag,
        size: write.size,
        contentType: resolvedType,
      };
      if (url) result.url = url;
      if (write.versionId) result.versionId = write.versionId;
      if (image) result.image = image;
      return result;
    });
  }

  /**
   * Stage a streamed body under a temp key, then key it by its post-write SHA-256
   * digest (content-addressed). If an object already exists at the digest key the
   * upload is idempotent — the staging copy is dropped and the existing object is
   * returned. Otherwise the staged bytes are re-streamed to the digest key and the
   * staging copy removed.
   */
  private async uploadShaFromStream(
    bucket: string,
    stream: Readable,
    resolvedType: string,
    maxBytes: number,
    ctx: KeyStrategyContext,
    userMetadata?: Record<string, string>,
  ): Promise<{ key: string; etag: string; versionId?: string; size: number; sha256?: string }> {
    const stagingKey = `_ob-staging/${randomUUID()}`;
    const staged = await this.objects.putFromStream(bucket, stagingKey, stream, resolvedType, maxBytes);
    const key = resolveKey('sha256', { ...ctx, sha256: staged.sha256 });

    const existing = await this.objects.head(bucket, key);
    if (existing) {
      await this.objects.delete(bucket, stagingKey);
      return {
        key,
        etag: existing.etag,
        versionId: existing.versionId,
        size: existing.size,
        sha256: staged.sha256,
      };
    }

    const opened = await this.objects.openObjectStream(bucket, stagingKey);
    if (!opened) throw new NoSuchKeyError(stagingKey);
    const finalWrite = await this.objects.putFromStream(
      bucket,
      key,
      opened.stream,
      resolvedType,
      undefined,
      userMetadata,
    );
    await this.objects.delete(bucket, stagingKey);
    return { key, ...finalWrite };
  }

  /** Mint a GET url for an upload result, or `undefined` when no origin resolves. */
  private resolveUploadUrl(
    bucket: string,
    key: string,
    presign: PresignOptions | false | undefined,
  ): string | undefined {
    if (presign === false) return undefined;
    const hasOrigin = Boolean(presign?.baseUrl) || Boolean(this.config.endpoint);
    if (!hasOrigin) return undefined;
    return this.presignGetUrl(bucket, key, presign ?? {});
  }

  /**
   * Read at most `n` bytes off the front of `body` for sniffing, then hand back a
   * stream that replays those bytes followed by the untouched remainder — so a
   * `Readable` is never fully buffered (only the `SNIFF_BYTES` head is held).
   */
  private async peekHead(
    body: Readable | Buffer,
    n: number,
  ): Promise<{ head: Buffer; stream: Readable; knownEnd: boolean }> {
    if (Buffer.isBuffer(body)) {
      return { head: body.subarray(0, n), stream: Readable.from(body), knownEnd: true };
    }
    const collected: Buffer[] = [];
    let total = 0;
    // destroyOnReturn:false is REQUIRED — the default async iterator destroys the
    // stream when we break, which would lose the tail we still need to write.
    const iterator = body.iterator({ destroyOnReturn: false });
    try {
      while (total < n) {
        const next = await iterator.next();
        if (next.done) break;
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
        collected.push(chunk);
        total += chunk.length;
      }
    } catch (err) {
      body.destroy();
      throw err;
    }
    const head = Buffer.concat(collected).subarray(0, n);
    const source = body;
    const rebuilt = Readable.from(
      (async function* () {
        for (const c of collected) yield c;
        yield* source;
      })(),
    );
    return { head, stream: rebuilt, knownEnd: false };
  }

  /**
   * Open a readable stream of an object's (decrypted) bytes. Throws
   * `NoSuchKeyError` if absent. The stream may be consumed after this resolves —
   * it needs no MikroORM context.
   */
  async getObjectStream(bucket: string, key: string): Promise<Readable> {
    const opened = await this.withContext(() => this.objects.openObjectStream(bucket, key));
    if (!opened) throw new NoSuchKeyError(key);
    return opened.stream;
  }

  /** Read a whole object into a Buffer. Throws `NoSuchKeyError` if absent. */
  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.getObjectStream(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Object metadata (no body), or `null` if the key is absent. */
  headObject(bucket: string, key: string): Promise<ObjectInfo | null> {
    return this.withContext(async () => {
      const meta = await this.objects.head(bucket, key);
      if (!meta) return null;
      return {
        key: meta.key,
        size: meta.size,
        etag: meta.etag,
        contentType: meta.contentType,
        lastModified: meta.lastModified,
        versionId: meta.versionId,
        userMetadata: meta.userMetadata,
      };
    });
  }

  /** Delete an object. Idempotent — a missing key resolves without error. */
  deleteObject(bucket: string, key: string): Promise<void> {
    return this.withContext(() => this.objects.delete(bucket, key));
  }

  /**
   * List objects in a bucket. `delimiter` rolls keys up into `commonPrefixes`
   * (folder-style browsing); page with `marker` (pass back the previous page's
   * `nextMarker`). `limit` defaults to 1000.
   */
  listObjects(bucket: string, opts: ListObjectsOptions = {}): Promise<ObjectListResult> {
    return this.withContext(() =>
      this.objects.list({
        bucket,
        prefix: opts.prefix,
        delimiter: opts.delimiter,
        marker: opts.marker,
        limit: Math.min(opts.limit ?? 1000, 1000),
      }),
    );
  }

  // ---- Presigned URLs (pure crypto; no DB/filesystem access) ----------

  /** A time-limited URL to download the object directly (signed GET). */
  presignGetUrl(bucket: string, key: string, opts: PresignOptions = {}): string {
    return this.presign('GET', bucket, key, opts);
  }

  /** A time-limited URL to upload the object directly (signed PUT). */
  presignPutUrl(bucket: string, key: string, opts: PresignOptions = {}): string {
    return this.presign('PUT', bucket, key, opts);
  }

  /**
   * Mint a browser-form direct upload (presigned POST, WHITEPAPER §2.5.1). Returns
   * `{ url, fields }` — hand every `fields` entry to a browser `FormData`, append
   * the `file` part LAST, and POST it to `url`. The policy is signed with the
   * root credential and authorises exactly the `key`/prefix, content-type, and
   * size range in its conditions until it expires. A `content-length-range` is
   * defaulted to the server's `maxObjectSizeMb` cap when the caller omits one, so
   * a minted token can never authorise an object larger than the server allows
   * (the wire interceptor re-enforces on streamed bytes). Pure crypto — no DB/FS.
   */
  createPresignedPost(bucket: string, opts: PresignPostOptions): PresignedPost {
    if (opts.contentLengthRange) {
      const { min, max } = opts.contentLengthRange;
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || min > max) {
        throw new Error(
          'OpenBucketService.createPresignedPost: contentLengthRange must be 0 ≤ min ≤ max.',
        );
      }
    }
    const expiresIn = Math.min(Math.max(opts.expiresIn ?? 900, 1), MAX_EXPIRES);
    const { scheme, host } = this.resolveOrigin(opts.baseUrl);

    // Default a content-length-range to the server cap (defence in depth) unless
    // the caller pinned one; then fold in any raw escape-hatch conditions.
    const lengthRange = opts.contentLengthRange ?? {
      min: 0,
      max: this.config.maxObjectSizeMb * 1024 * 1024,
    };
    const extraConditions: PostPolicyCondition[] = [
      ['content-length-range', lengthRange.min, lengthRange.max],
      ...(opts.conditions ?? []),
    ];

    return buildPresignedPost({
      accessKeyId: this.config.rootAccessKeyId,
      secretAccessKey: this.config.rootSecretAccessKey,
      region: this.config.region,
      scheme,
      host,
      bucket,
      key: opts.key,
      expiresIn,
      now: new Date(),
      basePath: this.mountPath,
      keyStartsWith: opts.keyStartsWith,
      contentType: opts.contentType,
      successActionStatus: opts.successActionStatus,
      successActionRedirect: opts.successActionRedirect,
      extraConditions,
    });
  }

  private presign(method: 'GET' | 'PUT', bucket: string, key: string, opts: PresignOptions): string {
    const expiresIn = Math.min(Math.max(opts.expiresIn ?? 900, 1), MAX_EXPIRES);
    const { scheme, host } = this.resolveOrigin(opts.baseUrl);
    return buildPresignedUrl({
      accessKeyId: this.config.rootAccessKeyId,
      secretAccessKey: this.config.rootSecretAccessKey,
      region: this.config.region,
      host,
      scheme,
      method,
      bucket,
      key,
      expiresIn,
      now: new Date(),
      basePath: this.mountPath,
    });
  }

  /** Resolve the public scheme + host for a presigned URL (path is added separately). */
  private resolveOrigin(baseUrl?: string): { scheme: string; host: string } {
    const raw = baseUrl ?? (this.config.endpoint ? `https://${this.config.endpoint}` : undefined);
    if (!raw) {
      throw new Error(
        'OpenBucketService: presign requires a `baseUrl` (e.g. "https://files.example.com") ' +
          'or the `endpoint` option to be set.',
      );
    }
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return { scheme: u.protocol.replace(/:$/, ''), host: u.host };
  }
}

/** Normalize an {@link UploadSource} to a common `{ body, declared, filename, knownSize }`. */
function normalizeUploadSource(source: UploadSource): {
  body: Readable | Buffer;
  declared?: string;
  filename?: string;
  knownSize?: number;
} {
  if (Buffer.isBuffer(source)) {
    return { body: source, knownSize: source.length };
  }
  if (source instanceof Readable) {
    return { body: source };
  }
  // MulterFileLike (memory-storage `buffer` or disk/stream-storage `stream`).
  const file = source as MulterFileLike;
  const body = file.buffer ?? file.stream;
  if (!body) {
    throw new TypeError('uploadFrom: multer file has neither a `buffer` nor a `stream`');
  }
  return {
    body,
    declared: file.mimetype,
    filename: file.originalname,
    knownSize: Buffer.isBuffer(file.buffer)
      ? file.buffer.length
      : typeof file.size === 'number'
        ? file.size
        : undefined,
  };
}
