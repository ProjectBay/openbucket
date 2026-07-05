import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { raw, type EntityManager } from '@mikro-orm/core';
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';

import {
  BucketRepository,
  ObjectEntity,
  ObjectLockMode,
  ObjectRepository,
} from '../../persistence/index';

import { BlobStore } from '../../storage/blob-store';
import { ObjectWriterService } from '../../storage/object-writer.service';
import { ObjectEventsService } from '../../events/object-events.service';
import { OBJECT_EVENTS, type ObjectEvent } from '../../events/object-event.types';
import {
  alignedStart,
  createRangeDecipher,
  createSseDecipher,
  skipBytes,
} from '../../storage/sse-cipher';
import { SseKeyService } from '../../storage/sse-key.service';
import { VersionStoreService } from '../../storage/version-store.service';
import { ReplicationOutboxService } from '../../storage/replication/replication-outbox.service';
import {
  AccessDeniedError,
  InternalError,
  InvalidArgumentError,
  NoSuchBucketError,
  NoSuchKeyError,
  NoSuchObjectLockConfigurationError,
  PreconditionFailedError,
} from '../../s3/errors/s3-error';
import { evaluatePolicy } from '../../s3/authz/policy-evaluator';
import type { PutObjectStreamContext } from '../../s3/object/put-object.interceptor';
import type { PostObjectContext } from '../../s3/object/post-object.interceptor';
import { parseRange, RangeSpec } from '../../s3/object/range';
import {
  legalHoldDoc,
  ownerFullAclDoc,
  parseLegalHold,
  parseRetention,
  parseTagSet,
  retentionDoc,
  taggingDoc,
} from '../../s3/xml/s3-config-docs';
import { XmlSerializer } from '../../s3/xml/xml.serializer';

/**
 * Content types a browser will execute/interpret as active content if served
 * inline on the app origin (stored XSS, CWE-79). `obj.contentType` is stored
 * verbatim from the PUT request, so an attacker can upload markup declared as
 * `text/html` and have it run as script when previewed inline.
 */
const ACTIVE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
]);

/** True if `contentType` (ignoring any `; charset=…` params) is active content. */
export function isActiveContentType(contentType: string): boolean {
  return ACTIVE_CONTENT_TYPES.has(contentType.split(';', 1)[0].trim().toLowerCase());
}

/**
 * Neutralize active content on a raw S3 object response before the first body
 * byte (TASK-2110, CWE-79). Every object read gets a locked-down CSP + `nosniff`;
 * for a stored `Content-Type` a browser would execute inline (HTML/XHTML/SVG) the
 * type is overridden to a non-rendering `application/octet-stream` and an
 * `attachment` disposition is forced, so uploaded markup can't run as script on
 * the admin/app origin. Returns the `Content-Type` value the caller should emit.
 * A pre-existing `attachment` disposition (e.g. the admin `?download` filename
 * variant) is preserved.
 */
export function applySafeObjectResponseHeaders(res: Response, contentType: string): string {
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!isActiveContentType(contentType)) return contentType;

  const existing = res.getHeader('Content-Disposition');
  if (typeof existing !== 'string' || !existing.toLowerCase().startsWith('attachment')) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  return 'application/octet-stream';
}

/** Admin object-listing input (§5.6). */
export interface AdminObjectListInput {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  marker?: string;
  limit: number;
}

/** A single object row in an admin listing (clean, serializable shapes). */
export interface AdminObjectListItem {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  storageClass: string;
}

/** One page of an admin object listing (§5.6). */
export interface AdminObjectListPage {
  contents: AdminObjectListItem[];
  commonPrefixes: string[];
  nextMarker?: string;
  isTruncated: boolean;
}

/** Object metadata for the admin browser (§5.6). */
export interface AdminObjectMeta {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  lastModified: Date;
  userMetadata?: Record<string, string>;
  tagging?: Record<string, string>;
  versionId?: string;
  storageClass: string;
}

/**
 * Split a flat key list into Contents + CommonPrefixes under S3 delimiter
 * semantics: a key whose remainder after `prefix` contains `delimiter` rolls up
 * to the prefix ending at the first delimiter. (Mirrors the S3 listing path.)
 */
function groupByDelimiter(
  rows: ObjectEntity[],
  prefix: string,
  delimiter: string | undefined,
): { contents: ObjectEntity[]; commonPrefixes: string[] } {
  if (!delimiter) return { contents: rows, commonPrefixes: [] };
  const contents: ObjectEntity[] = [];
  const commonPrefixes = new Set<string>();
  for (const o of rows) {
    const rest = o.key.slice(prefix.length);
    const idx = rest.indexOf(delimiter);
    if (idx !== -1) {
      commonPrefixes.add(prefix + rest.slice(0, idx + delimiter.length));
    } else {
      contents.push(o);
    }
  }
  return { contents, commonPrefixes: [...commonPrefixes] };
}

/**
 * S3 object-scope operations the `ObjectController` dispatches to. PutObject is
 * live (STORY-0302) via the streaming interceptor + two-phase ObjectWriter;
 * Get/Head/Delete/Copy and the tagging/acl/lock ops land across
 * STORY-0109/0303/0111…0116.
 */
@Injectable()
export class ObjectService {
  /**
   * Cap for read-time integrity verification of Range GETs: verifying a range
   * requires reading the WHOLE object, so above this size a range read is served
   * unverified rather than re-reading gigabytes per request (F1 documented
   * trade-off; per-block checksums would lift it). Full GETs are always verified.
   */
  private static readonly RANGE_VERIFY_MAX_BYTES = 64 * 1024 * 1024;

  constructor(
    private readonly writer: ObjectWriterService,
    private readonly buckets: BucketRepository,
    private readonly objects: ObjectRepository,
    private readonly blobs: BlobStore,
    private readonly versions: VersionStoreService,
    private readonly serializer: XmlSerializer,
    private readonly sseKey: SseKeyService,
    // Optional (STORY-0801): emits object.deleted at the delete choke point.
    // @Optional so existing unit tests can construct ObjectService without it and
    // a missing/throwing handler can never break a delete.
    @Optional() private readonly events?: ObjectEventsService,
    // Optional (STORY-0900): enqueues a durable DELETE replication intent IN the
    // delete's transaction (transactional outbox). @Optional so existing unit
    // tests construct ObjectService without it and a disabled deployment no-ops.
    @Optional() private readonly outbox?: ReplicationOutboxService,
  ) {}

  /**
   * Aggregate object count + total live size for a bucket (admin §5.5). Counts
   * only current, non-soft-deleted pointer rows. A single SQL aggregate — no row
   * hydration — so it stays cheap on large buckets.
   */
  async statsFor(bucket: string): Promise<{ objectCount: number; sizeBytes: number }> {
    const row = (await this.objects
      .getEntityManager()
      .createQueryBuilder(ObjectEntity, 'o')
      .select([raw('count(*) as objectCount'), raw('coalesce(sum(o.size), 0) as sizeBytes')])
      .where({ bucket, softDeleted: false })
      .execute('get')) as { objectCount: number; sizeBytes: number } | undefined;
    return {
      objectCount: Number(row?.objectCount ?? 0),
      sizeBytes: Number(row?.sizeBytes ?? 0),
    };
  }

  /**
   * Prefix/delimiter listing for the admin object browser (§5.6). Reuses the
   * same indexed range scan the S3 listing uses, then rolls keys up under the
   * delimiter into commonPrefixes. Clean shapes (number sizes, Date timestamps)
   * so the controller can serialize directly.
   */
  async list(input: AdminObjectListInput): Promise<AdminObjectListPage> {
    const prefix = input.prefix ?? '';
    const { rows, truncated } = await this.objects.listByPrefix(
      input.bucket,
      prefix,
      input.marker,
      input.limit,
    );
    const { contents, commonPrefixes } = groupByDelimiter(rows, prefix, input.delimiter);
    const nextMarker = truncated && rows.length > 0 ? rows[rows.length - 1].key : undefined;
    return {
      contents: contents.map((o) => ({
        key: o.key,
        size: Number(o.size),
        etag: o.etag,
        lastModified: o.modifiedAt,
        storageClass: o.storageClass,
      })),
      commonPrefixes,
      nextMarker,
      isTruncated: truncated,
    };
  }

  /** Object metadata for the admin browser (§5.6); null if the key is absent. */
  async head(bucket: string, key: string): Promise<AdminObjectMeta | null> {
    const o = await this.objects.findCurrentVersion(bucket, key);
    if (!o) return null;
    return {
      key: o.key,
      size: Number(o.size),
      etag: o.etag,
      contentType: o.contentType,
      lastModified: o.modifiedAt,
      userMetadata: o.userMetadata,
      tagging: o.tagging,
      versionId: o.currentVersionId,
      storageClass: o.storageClass,
    };
  }

  /** Admin object delete (§5.6) — idempotent, via the shared single-delete seam. */
  async delete(bucket: string, key: string): Promise<void> {
    await this.deleteOne(bucket, key);
  }

  /**
   * PUT /:bucket/:key — streams the PutObjectInterceptor-verified body through
   * the two-phase ObjectWriter (§4.1.3). The interceptor caps size and verifies
   * the digests; the writer stages + atomically renames the blob and commits the
   * row. Responds 200 with the MD5 ETag (and x-amz-version-id on versioned
   * buckets).
   */
  async putObject(req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const ctx = (req as unknown as { openbucketPutCtx?: PutObjectStreamContext }).openbucketPutCtx;
    if (!ctx) throw new InternalError();
    // The verifier's outcome also surfaces through writer.put (it consumes the
    // same stream), so a digest/size failure throws there. Mark these mirror
    // promises handled so the failure isn't also an unhandled rejection.
    ctx.hashes.catch(() => undefined);
    ctx.size.catch(() => undefined);

    if (!(await this.buckets.exists(bucket))) throw new NoSuchBucketError(bucket);

    const contentType =
      typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;

    const row = await this.writer.put({
      bucket,
      key,
      body: ctx.stream as Readable,
      contentType,
      userMetadata: extractUserMetadata(req.headers),
    });

    res.setHeader('ETag', `"${row.etag}"`);
    if (row.currentVersionId) res.setHeader('x-amz-version-id', row.currentVersionId);
    res.status(200);
    return undefined;
  }
  /**
   * Stream an admin upload straight to storage (PUT /api/admin/buckets/:name/
   * objects/:key, §5.14). The request body IS the object — bodyParser is off
   * globally — so the controller passes `req`. Mirrors the S3 PutObject write
   * path (same two-phase writer) but JWT-authed instead of SigV4.
   */
  async putFromStream(
    bucket: string,
    key: string,
    body: Readable,
    contentType?: string,
    maxSize?: number,
  ): Promise<{ etag: string; versionId?: string; size: number; sha256?: string }> {
    if (!(await this.buckets.exists(bucket))) throw new NoSuchBucketError(bucket);
    const row = await this.writer.put({ bucket, key, body, contentType, maxSize });
    return {
      etag: row.etag,
      versionId: row.currentVersionId,
      size: Number(row.size),
      sha256: row.contentSha256,
    };
  }

  /**
   * HTTP-agnostic full-object read (the in-process `OpenBucketService` facade).
   * Returns the current version's decrypted byte stream + metadata, or `null` if
   * the key is absent. No range — the whole object. SSE-S3 blobs are decrypted on
   * the fly (mirrors the GetObject path, STORY-0122). The returned stream is a
   * plain fs/transform stream; reading it needs no MikroORM context.
   */
  async openObjectStream(
    bucket: string,
    key: string,
  ): Promise<{ stream: Readable; size: number; contentType: string; etag: string; lastModified: Date; versionId?: string } | null> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) return null;

    let blob: { stream: import('node:fs').ReadStream };
    try {
      blob = await this.blobs.getBlob(bucket, key);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }

    let stream: Readable = blob.stream;
    if (obj.encryption) {
      const sk = this.sseKey.key();
      const iv = Buffer.from(obj.encryption.iv, 'base64');
      stream = blob.stream.pipe(createSseDecipher(sk, iv));
      // A decipher error must tear down the source fd too.
      stream.on('error', () => blob.stream.destroy());
    }

    return {
      stream,
      size: Number(obj.size),
      contentType: obj.contentType,
      etag: obj.etag,
      lastModified: obj.modifiedAt,
      versionId: obj.currentVersionId,
    };
  }

  /**
   * POST /:bucket — browser-form direct upload (WHITEPAPER §2.5.1, STORY-0802).
   * Bucket-scope: the key arrives as a form field, not a path segment. The
   * `PostObjectInterceptor` has already streaming-parsed the multipart body,
   * authenticated it against the submitted POST policy + signature, and stamped
   * the verified stream on `req.openbucketPutCtx` + `{ key, contentType,
   * accessKeyId, successAction }` on `req.openbucketPost`. Here we assert the
   * bucket exists, re-run the EPIC-08 bucket-policy check with the form-resolved
   * credential (SigV4Guard/PolicyAuthorizationGuard deferred it — auth wasn't
   * known pre-parse), persist through the same two-phase writer, and emit the
   * S3-correct success response (303 redirect / 201 XML / 204).
   */
  async postObject(req: Request, res: Response, bucket: string): Promise<unknown> {
    const ctx = (req as unknown as { openbucketPutCtx?: PutObjectStreamContext }).openbucketPutCtx;
    const post = (req as unknown as { openbucketPost?: PostObjectContext }).openbucketPost;
    if (!ctx || !post) throw new InternalError();
    // The writer consumes the same verified stream, so a digest/size failure
    // surfaces there; mark these mirror promises handled to avoid an unhandled
    // rejection (identical to putObject).
    ctx.hashes.catch(() => undefined);
    ctx.size.catch(() => undefined);

    const key = post.key;
    if (!key) throw new InvalidArgumentError('The key form field is required.', 'key');

    const bkt = await this.buckets.getByName(bucket);
    if (!bkt) throw new NoSuchBucketError(bucket);

    // EPIC-08 bucket policy, evaluated here (not the guard) because the principal
    // was unknown until the body was parsed. Identical semantics to
    // PolicyAuthorizationGuard: single-root default-allow, explicit Deny blocks.
    if (bkt.policy) {
      const decision = evaluatePolicy(
        bkt.policy,
        {
          action: 's3:PutObject',
          resource: `arn:aws:s3:::${bucket}/${key}`,
          principal: post.accessKeyId,
          secureTransport: req.secure === true,
          sourceIp: req.ip ?? '',
        },
        { defaultAllow: true },
      );
      if (decision === 'deny') throw new AccessDeniedError('Access Denied by bucket policy');
    }

    const row = await this.writer.put({
      bucket,
      key,
      body: ctx.stream as Readable,
      contentType: post.contentType,
    });

    const etag = `"${row.etag}"`;
    res.setHeader('ETag', etag);
    if (row.currentVersionId) res.setHeader('x-amz-version-id', row.currentVersionId);

    const location = `${req.protocol}://${req.get('host') ?? bucket}/${bucket}/${encodeURIComponent(
      key,
    )}`;

    // success_action_redirect wins: 303 with bucket/key/etag query params.
    if (post.successAction.redirect) {
      const target = new URL(post.successAction.redirect);
      target.searchParams.set('bucket', bucket);
      target.searchParams.set('key', key);
      target.searchParams.set('etag', row.etag);
      res.setHeader('Location', target.toString());
      res.status(303);
      return undefined;
    }
    // Else success_action_status: 201 → <PostResponse> XML; 200/204/absent → 204.
    if (post.successAction.status === '201') {
      res.status(201);
      return { __root: 'PostResponse', Location: location, Bucket: bucket, Key: key, ETag: etag };
    }
    res.status(204);
    return undefined;
  }

  /**
   * PUT /:bucket/:key with x-amz-copy-source — server-side copy (§2.8.3). Reads
   * the source blob and writes it to the destination via the two-phase writer.
   * Honours `x-amz-metadata-directive: COPY|REPLACE` and
   * `x-amz-copy-source-if-match`. Returns `<CopyObjectResult>`.
   */
  async copyObject(req: Request, _res: Response, bucket: string, key: string): Promise<unknown> {
    if (!(await this.buckets.exists(bucket))) throw new NoSuchBucketError(bucket);

    const { srcBucket, srcKey } = parseCopySource(req.headers['x-amz-copy-source'] as string);
    const src = await this.objects.findCurrentVersion(srcBucket, srcKey);
    if (!src) throw new NoSuchKeyError(srcKey);

    const ifMatch = req.headers['x-amz-copy-source-if-match'];
    if (typeof ifMatch === 'string' && ifMatch.replace(/"/g, '') !== src.etag) {
      throw new PreconditionFailedError(
        'At least one of the pre-conditions you specified did not hold',
      );
    }

    const replace =
      (req.headers['x-amz-metadata-directive'] as string | undefined)?.toUpperCase() === 'REPLACE';
    const contentType = replace
      ? typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type']
        : undefined
      : src.contentType;
    const userMetadata = replace ? extractUserMetadata(req.headers) : src.userMetadata;

    // Decrypt the source before handing bytes to the writer (TASK-2130,
    // CWE-325). getBlob returns the raw on-disk stream, which is ciphertext for
    // an SSE-encrypted source; streaming that straight into the writer would
    // hash + re-encrypt ciphertext-as-plaintext, corrupting the copy. Mirror the
    // GetObject/openObjectStream decrypt so the writer sees true plaintext: the
    // ETag/contentSha256 come out over plaintext and the destination bucket's own
    // encryption policy is applied cleanly.
    const blob = await this.blobs.getBlob(srcBucket, srcKey);
    let body: Readable = blob.stream;
    if (src.encryption) {
      const sk = this.sseKey.key();
      const iv = Buffer.from(src.encryption.iv, 'base64');
      body = blob.stream.pipe(createSseDecipher(sk, iv));
      body.on('error', () => blob.stream.destroy());
    }
    const row = await this.writer.put({
      bucket,
      key,
      body,
      contentType,
      userMetadata,
    });

    return {
      __root: 'CopyObjectResult',
      ETag: `"${row.etag}"`,
      LastModified: row.modifiedAt.toISOString(),
    };
  }

  /**
   * GET /:bucket/:key?attributes — `<GetObjectAttributesOutput>` (§2.8.3). The
   * GET dispatch runs in library-specific mode, so this serializes + writes the
   * response itself. Emits only the attributes named in `x-amz-object-attributes`.
   */
  async getObjectAttributes(
    req: Request,
    res: Response,
    bucket: string,
    key: string,
  ): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);

    const requested = String(req.headers['x-amz-object-attributes'] ?? '')
      .split(',')
      .map((s) => s.trim());
    const value: Record<string, unknown> = {};
    if (requested.includes('ETag')) value.ETag = obj.etag;
    if (requested.includes('ObjectSize')) value.ObjectSize = Number(obj.size);
    if (requested.includes('StorageClass')) value.StorageClass = obj.storageClass;

    const body = this.serializer.serialize('GetObjectAttributesOutput', value);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
    res.status(200).send(body);
    return undefined;
  }
  /**
   * GET /:bucket/:key — streams the stored bytes back (§4.2). Sets all headers
   * before the first body byte, honours a single `Range` (206 / 416), and
   * releases the file descriptor immediately if the client disconnects. Writes
   * the response directly and returns undefined so the XmlInterceptor passes
   * through.
   */
  async getObject(req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    const size = Number(obj.size);

    let range: RangeSpec | undefined;
    const rangeHeader = req.headers['range'];
    if (typeof rangeHeader === 'string' && rangeHeader.length > 0) {
      const parsed = parseRange(rangeHeader, size);
      if (parsed === 'invalid') {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.status(416);
        res.end();
        return undefined;
      }
      range = parsed;
    }

    // For an encrypted Range read we must fetch from the block-aligned offset so
    // the CTR keystream lines up; the intra-block prefix is dropped after decrypt.
    const readRange =
      obj.encryption && range ? { start: alignedStart(range.start), end: range.end } : range;

    // F1 read-time integrity: recompute the whole-object SHA-256 and compare it
    // to the stored contentSha256 BEFORE sending any bytes, so corruption at rest
    // (bit-rot / tampering) becomes a 500 instead of silently-served data. The
    // strong whole-object digest covers multipart objects too (whose ETag is
    // md5-of-md5s and can't be recomputed on read). Streaming can't retract bytes
    // once sent under Content-Length, so this is a pre-read pass. A Range read
    // must read the WHOLE object to verify, so it's capped at
    // RANGE_VERIFY_MAX_BYTES — above that a range GET is served unverified (a
    // full re-read would defeat the point of a range request; per-block checksums
    // are the scalable follow-up). Objects written before contentSha256 existed
    // (nullable) are skipped.
    if (obj.contentSha256 && (!range || size <= ObjectService.RANGE_VERIFY_MAX_BYTES)) {
      await this.verifyBlobIntegrity(bucket, key, obj.contentSha256, obj.encryption ?? undefined);
    }

    let blob: { stream: import('node:fs').ReadStream };
    try {
      blob = await this.blobs.getBlob(bucket, key, readRange);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NoSuchKeyError(key);
      throw err;
    }

    // Headers must precede the first body byte (Node throws otherwise). Neutralize
    // active content (CSP + nosniff + attachment/octet-stream for HTML/SVG) before
    // emitting the stored Content-Type (TASK-2110, CWE-79).
    res.setHeader('Content-Type', applySafeObjectResponseHeaders(res, obj.contentType));
    res.setHeader('ETag', `"${obj.etag}"`);
    res.setHeader('Last-Modified', obj.modifiedAt.toUTCString());
    res.setHeader('Accept-Ranges', 'bytes');
    if (obj.currentVersionId) res.setHeader('x-amz-version-id', obj.currentVersionId);
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(size));
    }

    const source = blob.stream;
    let outStream: NodeJS.ReadableStream = source;
    if (obj.encryption) {
      // SSE-S3 (STORY-0122): decrypt the ciphertext blob. For a Range, the
      // decipher is positioned at the block boundary; skip the intra-block prefix.
      const sk = this.sseKey.key();
      const iv = Buffer.from(obj.encryption.iv, 'base64');
      outStream = range
        ? source
            .pipe(createRangeDecipher(sk, iv, range.start))
            .pipe(skipBytes(range.start - alignedStart(range.start)))
        : source.pipe(createSseDecipher(sk, iv));
    }
    const onErr = (err: unknown): void => {
      if (!res.headersSent) res.status(500).end();
      else req.socket.destroy(err as Error);
    };
    // Release the source fd immediately on client disconnect (libuv would
    // otherwise hold it until GC).
    res.once('close', () => {
      if (!source.destroyed) source.destroy();
    });
    source.on('error', onErr);
    if (outStream !== source) outStream.on('error', onErr);
    outStream.pipe(res);
    return undefined;
  }

  /**
   * Re-read a blob (decrypting if needed), recompute its whole-object SHA-256,
   * and throw if it no longer matches the stored contentSha256 — i.e. the bytes
   * were corrupted at rest. getObject calls this as a pre-send integrity gate
   * (F1) so corruption becomes a 500 rather than silently-served bytes. Works
   * for single-part and multipart objects alike (the digest is over plaintext).
   */
  private async verifyBlobIntegrity(
    bucket: string,
    key: string,
    expectedSha256: string,
    encryption?: { iv: string },
  ): Promise<void> {
    let stream: import('node:fs').ReadStream;
    try {
      ({ stream } = await this.blobs.getBlob(bucket, key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NoSuchKeyError(key);
      throw err;
    }
    const sha = createHash('sha256');
    const plaintext: NodeJS.ReadableStream = encryption
      ? stream.pipe(createSseDecipher(this.sseKey.key(), Buffer.from(encryption.iv, 'base64')))
      : stream;
    await new Promise<void>((resolve, reject) => {
      plaintext.on('data', (c: Buffer) => sha.update(c));
      plaintext.on('end', () => resolve());
      plaintext.on('error', reject);
      if (plaintext !== stream) stream.on('error', reject);
    });
    const actual = sha.digest('hex');
    if (actual !== expectedSha256) {
      new Logger('ObjectService').error(
        `integrity check FAILED for ${bucket}/${key}: on-disk sha256=${actual} != stored ${expectedSha256} (corrupted at rest)`,
      );
      throw new InternalError();
    }
  }

  /**
   * HEAD /:bucket/:key — metadata headers only, never a body (§2.8.3). Mirrors
   * GetObject's headers without streaming. NoSuchKey when absent/soft-deleted
   * (the exception filter renders HEAD errors body-less).
   */
  async headObject(_req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    // Same active-content neutralization as GET (TASK-2110): a HEAD must advertise
    // the same safe Content-Type/disposition the body would be served with.
    res.setHeader('Content-Type', applySafeObjectResponseHeaders(res, obj.contentType));
    res.setHeader('ETag', `"${obj.etag}"`);
    res.setHeader('Last-Modified', obj.modifiedAt.toUTCString());
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(Number(obj.size)));
    for (const [name, value] of Object.entries(obj.userMetadata ?? {})) {
      res.setHeader(`x-amz-meta-${name}`, value);
    }
    if (obj.currentVersionId) res.setHeader('x-amz-version-id', obj.currentVersionId);
    res.status(200);
    return undefined;
  }

  /**
   * DELETE /:bucket/:key — 204 on success, idempotent on a missing key (§2.8.3).
   * Delegates to the shared `deleteOne` seam and surfaces delete-marker headers
   * for versioned buckets.
   */
  async deleteObject(req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const versionId =
      typeof req.query?.['versionId'] === 'string' ? (req.query['versionId'] as string) : undefined;
    const bypassGovernance = req.headers['x-amz-bypass-governance-retention'] === 'true';
    const result = await this.deleteOne(bucket, key, versionId, bypassGovernance);
    if (result.deleteMarker) res.setHeader('x-amz-delete-marker', 'true');
    if (result.versionId) res.setHeader('x-amz-version-id', result.versionId);
    res.status(204);
    return undefined;
  }

  /**
   * Single-object delete seam shared by DeleteObject and the bulk DeleteObjects
   * path (STORY-0108). Versioned buckets get a delete marker (history retained);
   * unversioned buckets soft-delete the row and move the blob to trash in one
   * transaction. Idempotent — a missing/already-deleted key succeeds silently.
   * (Permanent delete of a specific `versionId` is deferred — see note below.)
   */
  async deleteOne(
    bucket: string,
    key: string,
    _versionId?: string,
    bypassGovernance = false,
  ): Promise<{ versionId?: string; deleteMarker?: boolean }> {
    if (await this.buckets.hasVersionHistory(bucket)) {
      const current = await this.objects.findCurrentVersion(bucket, key);
      if (!current) return {}; // already hidden / never existed — no event (no-op)
      // A delete marker hides the current version without removing the locked
      // version, so object-lock does not gate it (AWS semantics).
      // STORY-0801: enqueue the durable webhook row IN the marker's transaction
      // (transactional outbox) via the beforeCommit hook, then emit in-process
      // after the marker commits. Build the event once so both carry identical bytes.
      let deletedEvent: ObjectEvent | undefined;
      const marker = await this.versions.writeDeleteMarker(bucket, key, (em, mk) => {
        deletedEvent = {
          type: OBJECT_EVENTS.deleted,
          bucket,
          key,
          size: 0,
          etag: '',
          versionId: mk.versionId,
          eventTime: new Date().toISOString(),
        };
        this.events?.enqueueInTx(em, deletedEvent);
        // Async replication (STORY-0900): a versioned delete hides the current
        // version, so one-way replication reflects the VISIBLE state by deleting
        // the remote key (per-version history is NOT replicated in v1). Enqueued
        // on the marker's transaction via the same beforeCommit seam as webhooks.
        this.outbox?.enqueue(em, { bucket: mk.bucket, key, op: 'DELETE' });
      });
      if (deletedEvent) this.events?.emitInProcess(deletedEvent);
      return { deleteMarker: true, versionId: marker.versionId };
    }

    // Unversioned: two-phase soft-delete + trash, transactional.
    const em = this.objects.getEntityManager().fork();
    await em.begin();
    try {
      const row = await em.findOne(ObjectEntity, {
        bucket: { name: bucket },
        key,
        softDeleted: false,
      });
      if (!row) {
        await em.commit();
        return {}; // idempotent no-op on an absent key — emit nothing
      }
      // This path actually removes the object — enforce object-lock (STORY-0121).
      this.assertDeletable(row, bypassGovernance);
      row.softDeleted = true;
      row.modifiedAt = new Date();
      em.persist(row);
      await this.blobs.deleteBlob(bucket, key); // move pointer file to trash

      // STORY-0801: enqueue the durable webhook row in this same transaction
      // (pre-commit), emit in-process only after a successful commit.
      const deletedEvent: ObjectEvent = {
        type: OBJECT_EVENTS.deleted,
        bucket,
        key,
        size: 0,
        etag: '',
        eventTime: row.modifiedAt.toISOString(),
      };
      this.events?.enqueueInTx(em, deletedEvent);

      // Async replication (STORY-0900): the object is gone locally, so reflect the
      // visible state remotely by enqueuing a DELETE intent in this transaction.
      this.outbox?.enqueue(em, { bucket: row.bucket, key, op: 'DELETE' });

      await em.commit();
      this.events?.emitInProcess(deletedEvent);
      return {};
    } catch (err) {
      await em.rollback().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Object-lock enforcement on a delete that would remove data (STORY-0121, §10).
   * Legal hold and active retention block the delete with `403 AccessDenied`;
   * GOVERNANCE retention is overridable by root via
   * `x-amz-bypass-governance-retention: true`, COMPLIANCE is never overridable.
   * Versioned delete-markers retain the locked version, so they are not gated.
   */
  private assertDeletable(row: ObjectEntity, bypassGovernance: boolean): void {
    const lock = row.lock;
    if (!lock) return;
    if (lock.legalHold === true) {
      throw new AccessDeniedError('object is under a legal hold');
    }
    if (lock.retainUntil && new Date(lock.retainUntil).getTime() > Date.now()) {
      if (lock.mode === ObjectLockMode.Compliance) {
        throw new AccessDeniedError(`object is locked in COMPLIANCE mode until ${lock.retainUntil}`);
      }
      if (lock.mode === ObjectLockMode.Governance && !bypassGovernance) {
        throw new AccessDeniedError(
          'object is locked in GOVERNANCE mode; set x-amz-bypass-governance-retention: true to override',
        );
      }
    }
  }
  // -------- Lifecycle sweep seams (EPIC-03, consumed by §4.10 runner) --
  /**
   * Page non-deleted current objects in (bucket, prefix) ordered by key, starting
   * strictly after `afterKey`. Backs the LifecycleSweepRunner's cursor paging —
   * reuses the same prefix range-scan as ListObjectsV2 (`ObjectRepository.listByPrefix`).
   */
  async scanForLifecycle(input: {
    bucket: string;
    prefix: string;
    afterKey: string | null;
    limit: number;
  }): Promise<Array<{ bucket: string; key: string; createdAt: Date }>> {
    const { rows } = await this.objects.listByPrefix(
      input.bucket,
      input.prefix,
      input.afterKey ?? undefined,
      input.limit,
    );
    return rows.map((r) => ({ bucket: input.bucket, key: r.key, createdAt: r.createdAt }));
  }

  /**
   * Soft-delete (bucket, key) and move its blob to trash, joining the caller's
   * transaction (`input.em`) so a batch of expirations commits atomically. The
   * trash-purge tick (STORY-0316) performs the actual unlink after the grace
   * period. Idempotent — a missing/already-deleted key is a no-op.
   */
  async moveToTrash(input: { em: EntityManager; bucket: string; key: string }): Promise<void> {
    const { em, bucket, key } = input;
    const row = await em.findOne(ObjectEntity, { bucket: { name: bucket }, key, softDeleted: false });
    if (!row) return;
    row.softDeleted = true;
    row.modifiedAt = new Date();
    em.persist(row);
    // Async replication (STORY-0900): a lifecycle expiry removes the visible
    // object — enqueue a DELETE intent on the runner's transaction so it rides
    // along on the same atomic commit as the batch of expirations.
    this.outbox?.enqueue(em, { bucket: row.bucket, key, op: 'DELETE' });
    await this.blobs.deleteBlob(bucket, key);
  }

  /**
   * POST /:bucket/:key?restore — v1 stub: archival/restore is a no-op, so we
   * accept the `<RestoreRequest>` body (ignored) and return 200 (§2.8.3).
   */
  restoreObject(_req: Request, res: Response, _bucket: string, _key: string): undefined {
    res.status(200);
    return undefined;
  }
  // -------- Tagging (§2.8.3, STORY-0111) -------------------------------
  /** PUT ?tagging — persist the parsed `<Tagging>` body on the current version. */
  async putTagging(req: Request, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    obj.tagging = parseTagSet((req as unknown as { xmlBody?: unknown }).xmlBody);
    await this.objects.getEntityManager().persistAndFlush(obj);
    return undefined;
  }
  /**
   * GET ?tagging — `<Tagging>` doc; empty `<TagSet/>` (200) when no tags
   * (GetObjectTagging never 404s on a missing tag set, unlike the bucket op).
   * The object GET route runs in library-specific mode (`@Res()` without
   * passthrough — see ObjectController), so this writes the response itself.
   */
  async getTagging(_req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    return this.sendXml(res, 'Tagging', taggingDoc(obj.tagging));
  }
  /** DELETE ?tagging — clear the tag set; 204. */
  async deleteTagging(_req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    obj.tagging = undefined;
    await this.objects.getEntityManager().persistAndFlush(obj);
    res.status(204);
    return undefined;
  }

  // ---- Admin JSON adapters (STORY-0612) ------------------------------
  // HTTP-agnostic seams the admin controller maps to JSON, vs the req/res
  // S3 handlers above. Same domain errors → same JSON statuses.

  /** Current-version tag map (empty {} when untagged); NoSuchKey (404) if absent. */
  async getTaggingMap(bucket: string, key: string): Promise<Record<string, string>> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    return obj.tagging ?? {};
  }

  /** Replace the current-version tag set. */
  async setTaggingMap(bucket: string, key: string, tags: Record<string, string>): Promise<void> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    obj.tagging = tags;
    await this.objects.getEntityManager().persistAndFlush(obj);
  }

  /** Clear the current-version tag set. */
  async clearTaggingMap(bucket: string, key: string): Promise<void> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    obj.tagging = undefined;
    await this.objects.getEntityManager().persistAndFlush(obj);
  }

  /** Object versions + delete markers as JSON (admin adapter for ListVersions). */
  async listVersionsJson(
    bucket: string,
    opts: { prefix?: string; keyMarker?: string; versionIdMarker?: string; maxKeys?: number },
  ): Promise<{
    versions: {
      key: string;
      versionId: string;
      isLatest: boolean;
      lastModified: string;
      etag: string;
      size: number;
    }[];
    deleteMarkers: { key: string; versionId: string; isLatest: boolean; lastModified: string }[];
    isTruncated: boolean;
    nextKeyMarker?: string;
    nextVersionIdMarker?: string;
  }> {
    const prefix = opts.prefix ?? '';
    const maxKeys = Math.min(opts.maxKeys ?? 100, 1000);
    const rows = await this.objects.listVersionsByPrefix(
      bucket,
      prefix,
      opts.keyMarker,
      opts.versionIdMarker,
      maxKeys,
    );
    const truncated = rows.length > maxKeys;
    const page = rows.slice(0, maxKeys);
    const seenLatest = new Set<string>();
    const versions: {
      key: string;
      versionId: string;
      isLatest: boolean;
      lastModified: string;
      etag: string;
      size: number;
    }[] = [];
    const deleteMarkers: {
      key: string;
      versionId: string;
      isLatest: boolean;
      lastModified: string;
    }[] = [];
    for (const v of page) {
      const isLatest = !seenLatest.has(v.key);
      seenLatest.add(v.key);
      if (v.isDeleteMarker) {
        deleteMarkers.push({
          key: v.key,
          versionId: v.versionId,
          isLatest,
          lastModified: v.createdAt.toISOString(),
        });
      } else {
        versions.push({
          key: v.key,
          versionId: v.versionId,
          isLatest,
          lastModified: v.createdAt.toISOString(),
          etag: v.etag,
          size: Number(v.size),
        });
      }
    }
    const last = truncated ? page[page.length - 1] : undefined;
    return {
      versions,
      deleteMarkers,
      isTruncated: truncated,
      ...(last ? { nextKeyMarker: last.key, nextVersionIdMarker: last.versionId } : {}),
    };
  }

  /** Object retention; NoSuchObjectLockConfiguration (404) when none is set. */
  async getRetentionJson(
    bucket: string,
    key: string,
  ): Promise<{ mode: 'GOVERNANCE' | 'COMPLIANCE'; retainUntil: string }> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    if (!obj.lock?.retainUntil || obj.lock.mode === ObjectLockMode.Off) {
      throw new NoSuchObjectLockConfigurationError();
    }
    return {
      mode: obj.lock.mode === ObjectLockMode.Compliance ? 'COMPLIANCE' : 'GOVERNANCE',
      retainUntil: obj.lock.retainUntil,
    };
  }

  /** Set object retention (preserving any legal hold). */
  async setRetention(
    bucket: string,
    key: string,
    mode: 'GOVERNANCE' | 'COMPLIANCE',
    retainUntil: string,
  ): Promise<void> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    const lockMode =
      mode === 'COMPLIANCE' ? ObjectLockMode.Compliance : ObjectLockMode.Governance;
    obj.lock = { ...(obj.lock ?? {}), mode: lockMode, retainUntil };
    await this.objects.getEntityManager().persistAndFlush(obj);
  }

  /** Object legal-hold status; defaults to OFF when unset. */
  async getLegalHoldStatus(bucket: string, key: string): Promise<{ status: 'ON' | 'OFF' }> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    return { status: obj.lock?.legalHold === true ? 'ON' : 'OFF' };
  }

  /** Set object legal-hold (preserving any retention). */
  async setLegalHold(bucket: string, key: string, on: boolean): Promise<void> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    obj.lock = { mode: ObjectLockMode.Off, ...(obj.lock ?? {}), legalHold: on };
    await this.objects.getEntityManager().persistAndFlush(obj);
  }

  // -------- ACL (§2.8.3, STORY-0111) — single-tenant owner-full -------
  /** PUT ?acl — accepted and ignored (single-tenant is always owner-full). */
  async putAcl(_req: Request, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    return undefined;
  }
  /** GET ?acl — always the owner-full ACL. Writes the response directly (the
   *  object GET route is in library-specific mode; see getTagging). */
  async getAcl(_req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    return this.sendXml(res, 'AccessControlPolicy', ownerFullAclDoc());
  }

  /** Serialize an XML POJO and write it to `res` (200). For the object GET
   *  sub-resource ops, which run in library-specific mode and so must finalize
   *  the response themselves rather than returning a POJO to the XmlInterceptor. */
  private sendXml(res: Response, rootName: string, doc: unknown): undefined {
    const body = this.serializer.serialize(rootName, doc);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
    res.status(200).send(body);
    return undefined;
  }
  // -------- Object Lock retention / legal hold (§2.8.3, STORY-0115) ----
  /** PUT ?retention — persist `<Retention>` (Mode + RetainUntilDate) on the
   *  current version, preserving any existing legal hold. */
  async putRetention(req: Request, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    const { mode, retainUntil } = parseRetention((req as unknown as { xmlBody?: unknown }).xmlBody);
    obj.lock = { ...(obj.lock ?? {}), mode, retainUntil };
    await this.objects.getEntityManager().persistAndFlush(obj);
    return undefined;
  }
  /** GET ?retention — `<Retention>`; `NoSuchObjectLockConfiguration` (404) when the
   *  object has no retention set. Writes the response directly (library mode;
   *  see getTagging). */
  async getRetention(_req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    if (!obj.lock?.retainUntil || obj.lock.mode === ObjectLockMode.Off) {
      throw new NoSuchObjectLockConfigurationError();
    }
    return this.sendXml(res, 'Retention', retentionDoc(obj.lock));
  }
  /** PUT ?legal-hold — persist `<LegalHold><Status>ON|OFF</Status></LegalHold>` on
   *  the current version, preserving any existing retention. */
  async putLegalHold(req: Request, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    const on = parseLegalHold((req as unknown as { xmlBody?: unknown }).xmlBody);
    obj.lock = { mode: ObjectLockMode.Off, ...(obj.lock ?? {}), legalHold: on };
    await this.objects.getEntityManager().persistAndFlush(obj);
    return undefined;
  }
  /** GET ?legal-hold — `<LegalHold>`; defaults to `OFF` when none is set. Writes
   *  the response directly (library mode; see getTagging). */
  async getLegalHold(_req: Request, res: Response, bucket: string, key: string): Promise<undefined> {
    const obj = await this.objects.findCurrentVersion(bucket, key);
    if (!obj) throw new NoSuchKeyError(key);
    return this.sendXml(res, 'LegalHold', legalHoldDoc(obj.lock?.legalHold === true));
  }
}

/**
 * Parse `x-amz-copy-source` (`/<bucket>/<key>` or `<bucket>/<key>`, URL-encoded,
 * optional `?versionId=`) into its bucket/key parts.
 */
function parseCopySource(header: string): { srcBucket: string; srcKey: string } {
  let s = decodeURIComponent((header ?? '').split('?')[0]);
  if (s.startsWith('/')) s = s.slice(1);
  const slash = s.indexOf('/');
  if (slash === -1) return { srcBucket: s, srcKey: '' };
  return { srcBucket: s.slice(0, slash), srcKey: s.slice(slash + 1) };
}

/** Collect `x-amz-meta-*` request headers into the object's user metadata. */
function extractUserMetadata(headers: IncomingHttpHeaders): Record<string, string> | undefined {
  const meta: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith('x-amz-meta-') && typeof value === 'string') {
      meta[name.slice('x-amz-meta-'.length)] = value;
    }
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}
