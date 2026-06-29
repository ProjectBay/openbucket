import { Inject, Injectable, Optional } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { InjectMikroORM } from '@mikro-orm/nestjs';
import { Readable } from 'node:stream';

import { AppConfigService } from './common/config/app-config.service';
import { BucketService } from './domain/buckets/bucket.service';
import { ObjectService } from './domain/objects/object.service';
import { OPEN_BUCKET_OPTIONS, type ResolvedOpenBucketOptions } from './open-bucket-options';
import { OPEN_BUCKET_ORM_CONTEXT } from './persistence/orm-context';
import { NoSuchKeyError } from './s3/errors/s3-error';
import { buildPresignedUrl, MAX_EXPIRES } from './s3/sigv4/presigned';

/** Result of an in-process object write. */
export interface PutObjectResult {
  etag: string;
  /** Present on versioning-enabled buckets. */
  versionId?: string;
}

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
  createBucket(
    name: string,
    opts: { versioning?: boolean; objectLock?: boolean } = {},
  ): Promise<void> {
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
    opts: { contentType?: string } = {},
  ): Promise<PutObjectResult> {
    const stream = body instanceof Readable ? body : Readable.from(body);
    return this.withContext(() => this.objects.putFromStream(bucket, key, stream, opts.contentType));
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
  listObjects(
    bucket: string,
    opts: { prefix?: string; delimiter?: string; marker?: string; limit?: number } = {},
  ): Promise<ObjectListResult> {
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
