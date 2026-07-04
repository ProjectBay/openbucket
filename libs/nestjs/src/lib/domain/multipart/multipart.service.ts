import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';
import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import type { Readable } from 'node:stream';

import {
  Bucket,
  BucketRepository,
  MultipartPart,
  MultipartUpload,
  ObjectRepository,
  nextStringBound,
} from '../../persistence/index';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

import { BlobRef, BlobStore } from '../../storage/blob-store';
import { ObjectWriterService } from '../../storage/object-writer.service';
import {
  alignedStart,
  createRangeDecipher,
  createSseDecipher,
  skipBytes,
} from '../../storage/sse-cipher';
import { SseKeyService } from '../../storage/sse-key.service';
import { AppConfigService } from '../../common/config/app-config.service';
import {
  EntityTooSmallError,
  InternalError,
  InvalidArgumentError,
  InvalidPartError,
  InvalidPartOrderError,
  MalformedXMLError,
  NoSuchBucketError,
  NoSuchKeyError,
  NoSuchUploadError,
  SlowDownError,
} from '../../s3/errors/s3-error';
import type { PutObjectStreamContext } from '../../s3/object/put-object.interceptor';
import { parseRange } from '../../s3/object/range';
import { XmlSerializer } from '../../s3/xml/xml.serializer';

const MAX_UPLOADS_CAP = 1000;
const MIN_PART_BYTES = 5 * 1024 * 1024;

/** A part as declared in the CompleteMultipartUpload body. */
export interface CompletePart {
  partNumber: number;
  etag: string;
}

/**
 * Multipart-scope operations dispatched by `ObjectController` and the
 * `MultipartController`. ListMultipartUploads (bucket scope) and Initiate are
 * live; UploadPart/Complete/Abort land across STORY-0306…0308.
 */
@Injectable()
export class MultipartService {
  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    private readonly buckets: BucketRepository,
    private readonly blobs: BlobStore,
    private readonly writer: ObjectWriterService,
    private readonly objects: ObjectRepository,
    private readonly serializer: XmlSerializer,
    private readonly sseKey: SseKeyService,
    private readonly config: AppConfigService,
  ) {}

  // Serialize Complete/Abort per uploadId (F7): otherwise two concurrent
  // completes (or a complete racing an abort) both validate + compose, and one's
  // staging cleanup can ENOENT the other mid-compose (spurious 500), or a
  // completed upload gets re-completed. Keyed promise-chain mutex.
  private readonly uploadLocks = new Map<string, Promise<void>>();

  private async withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.uploadLocks.get(uploadId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const newTail = prev.then(() => mine);
    this.uploadLocks.set(uploadId, newTail);
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.uploadLocks.get(uploadId) === newTail) this.uploadLocks.delete(uploadId);
    }
  }

  /**
   * GET /:bucket?uploads → `<ListMultipartUploadsResult>` (§2.8.2). Lists every
   * pending upload in the bucket, ordered by (key, initiated).
   */
  async listMultipartUploads(req: Request, bucket: string): Promise<unknown> {
    const q = req.query as Record<string, unknown>;
    const prefix = typeof q['prefix'] === 'string' ? (q['prefix'] as string) : '';
    const maxRaw = typeof q['max-uploads'] === 'string' ? Number.parseInt(q['max-uploads'], 10) : NaN;
    const maxUploads =
      Number.isFinite(maxRaw) && maxRaw >= 0 ? Math.min(maxRaw, MAX_UPLOADS_CAP) : MAX_UPLOADS_CAP;

    // Literal, byte-wise prefix match via an indexed range scan (S3 semantics),
    // mirroring ObjectRepository.listByPrefix. Using `$like` here would let `%`/`_`
    // in the client prefix act as SQL LIKE wildcards (TASK-2162, CWE-150).
    const rows = await this.em.find(
      MultipartUpload,
      prefix.length > 0
        ? { bucket: { name: bucket }, key: { $gte: prefix, $lt: nextStringBound(prefix) } }
        : { bucket: { name: bucket } },
      { orderBy: { key: 'ASC', initiatedAt: 'ASC' }, limit: maxUploads + 1 },
    );
    const truncated = rows.length > maxUploads;
    const page = rows.slice(0, maxUploads);

    return {
      __root: 'ListMultipartUploadsResult',
      Bucket: bucket,
      KeyMarker: '',
      UploadIdMarker: '',
      MaxUploads: maxUploads,
      IsTruncated: truncated,
      Upload: page.map((u) => ({
        Key: u.key,
        UploadId: u.uploadId,
        Initiator: { ID: 'openbucket-root', DisplayName: u.initiator },
        Owner: { ID: 'openbucket-root', DisplayName: 'openbucket' },
        StorageClass: 'STANDARD',
        Initiated: u.initiatedAt.toISOString(),
      })),
    };
  }

  /**
   * POST /:bucket/:key?uploads — open a multipart session (§4.4.1). Creates the
   * staging dir `<DATA_DIR>/multipart/<uploadId>/` (0o700) and the
   * `multipart_uploads` row, returns `<InitiateMultipartUploadResult>`.
   */
  async createUpload(req: Request, res: Response, bucket: string, key: string): Promise<unknown> {
    if (!(await this.buckets.exists(bucket))) throw new NoSuchBucketError(bucket);

    // Bound concurrent in-flight multipart sessions (TASK-2140, CWE-770): each
    // open upload can stage up to MAX_MULTIPART_PARTS files, so an unbounded
    // number of sessions is a disk-fill amplifier. 0 disables the cap.
    const maxUploads = this.config.maxConcurrentMultipartUploads;
    if (maxUploads > 0) {
      const open = await this.em.count(MultipartUpload, {});
      if (open >= maxUploads) {
        throw new SlowDownError('too many multipart uploads in progress; retry later');
      }
    }

    const uploadId = randomUUID();
    await fs.mkdir(this.blobs.paths.multipartDir(uploadId), { recursive: true, mode: 0o700 });

    const em = this.em.fork();
    const bucketRow = await em.findOneOrFail(Bucket, { name: bucket });
    const contentType =
      typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type']
        : 'application/octet-stream';
    const upload = em.create(MultipartUpload, {
      uploadId,
      bucket: bucketRow,
      key,
      contentType,
    });
    await em.persistAndFlush(upload);

    res.status(200);
    return { __root: 'InitiateMultipartUploadResult', Bucket: bucket, Key: key, UploadId: uploadId };
  }
  /**
   * POST /:bucket/:key?uploadId= — assemble the parts (§4.4.3). Validates the
   * declared list (non-empty, contiguous 1..N, ETags match the recorded parts,
   * each ≥ 5 MiB except the last), composes the final blob with the multipart
   * ETag `md5(concat(md5ᵢ))-N`, commits the object row, and discards the staging
   * area. Returns `<CompleteMultipartUploadResult>`.
   */
  async completeUpload(
    req: Request,
    res: Response,
    bucket: string,
    key: string,
    uploadId: string,
    declared: CompletePart[],
  ): Promise<unknown> {
    return this.withUploadLock(uploadId, () =>
      this.completeUploadLocked(req, res, bucket, key, uploadId, declared),
    );
  }

  private async completeUploadLocked(
    _req: Request,
    res: Response,
    bucket: string,
    key: string,
    uploadId: string,
    declared: CompletePart[],
  ): Promise<unknown> {
    const em = this.em.fork();
    const upload = await em.findOne(MultipartUpload, { uploadId });
    if (!upload) throw new NoSuchUploadError();
    if (declared.length === 0) {
      throw new MalformedXMLError('CompleteMultipartUpload requires at least one part');
    }

    const sorted = [...declared].sort((a, b) => a.partNumber - b.partNumber);
    // Part numbers must be in [1, 10000] and unique; they need NOT be contiguous
    // (real S3 permits sparse part numbers, e.g. [1, 2, 4]) — F10.
    for (let i = 0; i < sorted.length; i++) {
      const pn = sorted[i].partNumber;
      if (!Number.isInteger(pn) || pn < 1 || pn > 10_000) throw new InvalidPartError(pn);
      if (i > 0 && pn === sorted[i - 1].partNumber) throw new InvalidPartOrderError();
    }

    const recorded = new Map(
      (await em.find(MultipartPart, { upload })).map((p) => [p.partNumber, p]),
    );
    const refs: BlobRef[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      const rec = recorded.get(d.partNumber);
      if (!rec || rec.etag !== dequote(d.etag)) throw new InvalidPartError(d.partNumber);
      const path = this.blobs.paths.multipartPartPath(uploadId, d.partNumber);
      const st = await fs.stat(path).catch(() => null);
      if (!st) throw new InvalidPartError(d.partNumber);
      if (i !== sorted.length - 1 && st.size < MIN_PART_BYTES) throw new EntityTooSmallError();
      refs.push({ path, size: BigInt(st.size) });
    }

    const partsMd5 = Buffer.concat(sorted.map((p) => Buffer.from(dequote(p.etag), 'hex')));
    const etag = `${createHash('md5').update(partsMd5).digest('hex')}-${sorted.length}`;

    const row = await this.writer.putComposed({
      bucket,
      key,
      parts: refs,
      etag,
      contentType: upload.contentType,
    });

    // Discard the staging area: rows (cascade to parts) + the on-disk dir.
    await em.nativeDelete(MultipartUpload, { uploadId });
    await fs.rm(this.blobs.paths.multipartDir(uploadId), { recursive: true, force: true });

    if (row.currentVersionId) res.setHeader('x-amz-version-id', row.currentVersionId);
    res.status(200);
    return {
      __root: 'CompleteMultipartUploadResult',
      Location: `/${bucket}/${key}`,
      Bucket: bucket,
      Key: key,
      ETag: `"${etag}"`,
    };
  }
  /**
   * DELETE /:bucket/:key?uploadId= — discard a multipart session (§4.4.4):
   * remove the rows (cascade to parts) and the on-disk staging dir. 204 on
   * success; NoSuchUpload when the session is unknown.
   */
  async abortUpload(
    req: Request,
    res: Response,
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<undefined> {
    return this.withUploadLock(uploadId, () =>
      this.abortUploadLocked(req, res, bucket, key, uploadId),
    );
  }

  private async abortUploadLocked(
    _req: Request,
    res: Response,
    _bucket: string,
    _key: string,
    uploadId: string,
  ): Promise<undefined> {
    const em = this.em.fork();
    const upload = await em.findOne(MultipartUpload, { uploadId });
    if (!upload) throw new NoSuchUploadError();

    await em.nativeDelete(MultipartUpload, { uploadId });
    await fs.rm(this.blobs.paths.multipartDir(uploadId), { recursive: true, force: true });

    res.status(204);
    return undefined;
  }
  /**
   * PUT /:bucket/:key?uploadId=&partNumber= — stage one part (§4.4.2). The
   * PutObjectInterceptor has already validated + size-capped the body; we stream
   * it to `<N>.part` via the O_EXCL-safe BlobStore.putPart and upsert the
   * multipart_parts row (last-writer-wins). Responds 200 with the part's MD5 ETag.
   */
  async uploadPart(
    req: Request,
    res: Response,
    _bucket: string,
    _key: string,
    q: Record<string, string | undefined>,
  ): Promise<undefined> {
    const maxParts = this.config.maxMultipartParts;
    const partNumber = Number(q['partNumber']);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > maxParts) {
      throw new InvalidArgumentError(`partNumber must be in [1, ${maxParts}]`, 'partNumber', q['partNumber']);
    }
    const uploadId = q['uploadId'] as string;

    const em = this.em.fork();
    const upload = await em.findOne(MultipartUpload, { uploadId });
    if (!upload) throw new NoSuchUploadError();

    const ctx = (req as unknown as { openbucketPutCtx?: PutObjectStreamContext }).openbucketPutCtx;
    if (!ctx) throw new InternalError();
    // The interceptor's verifier surfaces digest/size failures through the
    // stream (putPart rejects), so mark its mirror promises handled.
    ctx.hashes.catch(() => undefined);
    ctx.size.catch(() => undefined);

    const { etag, size } = await this.blobs.putPart(uploadId, partNumber, ctx.stream as Readable);
    await this.upsertPart(em, upload, partNumber, size, etag);

    res.setHeader('ETag', `"${etag}"`);
    res.status(200);
    return undefined;
  }
  /**
   * PUT /:bucket/:key?uploadId=&partNumber= with x-amz-copy-source — stage a
   * part copied (optionally a byte range) from an existing object (§2.8.4).
   * Returns `<CopyPartResult>`.
   */
  async uploadPartCopy(
    req: Request,
    _res: Response,
    _bucket: string,
    _key: string,
    q: Record<string, string | undefined>,
  ): Promise<unknown> {
    const maxParts = this.config.maxMultipartParts;
    const partNumber = Number(q['partNumber']);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > maxParts) {
      throw new InvalidArgumentError(`partNumber must be in [1, ${maxParts}]`, 'partNumber', q['partNumber']);
    }
    const uploadId = q['uploadId'] as string;

    const em = this.em.fork();
    const upload = await em.findOne(MultipartUpload, { uploadId });
    if (!upload) throw new NoSuchUploadError();

    const { srcBucket, srcKey } = parseCopySource(req.headers['x-amz-copy-source'] as string);
    const src = await this.objects.findCurrentVersion(srcBucket, srcKey);
    if (!src) throw new NoSuchKeyError(srcKey);

    // Optional x-amz-copy-source-range: bytes=start-end. Interpreted against the
    // PLAINTEXT byte offsets of the source object.
    const rangeHeader = req.headers['x-amz-copy-source-range'];
    let range: { start: number; end: number } | undefined;
    if (typeof rangeHeader === 'string' && rangeHeader.length > 0) {
      const parsed = parseRange(rangeHeader, Number(src.size));
      if (parsed === 'invalid') {
        throw new InvalidArgumentError('invalid x-amz-copy-source-range', 'x-amz-copy-source-range', rangeHeader);
      }
      range = parsed;
    }

    // The source blob is ciphertext when the source object is SSE-encrypted
    // (TASK-2130, CWE-325): decrypt it here so the copied part is hashed + staged
    // as PLAINTEXT, exactly as the GetObject read path does. For a range we read
    // from the block-aligned ciphertext offset and drop the intra-block prefix so
    // the CTR keystream lines up at the requested plaintext start.
    const readRange =
      src.encryption && range ? { start: alignedStart(range.start), end: range.end } : range;
    const blob = await this.blobs.getBlob(srcBucket, srcKey, readRange);
    let partStream: Readable = blob.stream;
    if (src.encryption) {
      const sk = this.sseKey.key();
      const iv = Buffer.from(src.encryption.iv, 'base64');
      partStream = range
        ? blob.stream
            .pipe(createRangeDecipher(sk, iv, range.start))
            .pipe(skipBytes(range.start - alignedStart(range.start)))
        : blob.stream.pipe(createSseDecipher(sk, iv));
      // A decipher error must tear down the source fd too.
      partStream.on('error', () => blob.stream.destroy());
    }

    const { etag, size } = await this.blobs.putPart(uploadId, partNumber, partStream);
    await this.upsertPart(em, upload, partNumber, size, etag);

    return {
      __root: 'CopyPartResult',
      ETag: `"${etag}"`,
      LastModified: new Date().toISOString(),
    };
  }

  /**
   * GET /:bucket/:key?uploadId= → `<ListPartsResult>` (§2.8.4). The object GET
   * dispatch runs in library-specific mode, so this serializes + writes the
   * response itself.
   */
  async listParts(
    req: Request,
    res: Response,
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<undefined> {
    const em = this.em.fork();
    const upload = await em.findOne(MultipartUpload, { uploadId });
    if (!upload) throw new NoSuchUploadError();

    // Honour the S3 pagination query params (TASK-2142, CWE-770): clamp
    // `max-parts` to [1, 1000] (default 1000) and read `part-number-marker` as
    // the exclusive lower bound. Previously every row was materialized into one
    // XML doc with a hardcoded MaxParts:1000 / IsTruncated:false (wrong).
    const q = (req.query ?? {}) as Record<string, unknown>;
    const maxParts = clampInt(q['max-parts'], 1, 1000, 1000);
    const marker = clampInt(q['part-number-marker'], 0, Number.MAX_SAFE_INTEGER, 0);

    // Fetch one extra row to detect truncation without a separate count.
    const rows = await em.find(
      MultipartPart,
      { upload, partNumber: { $gt: marker } },
      { orderBy: { partNumber: 'ASC' }, limit: maxParts + 1 },
    );
    const isTruncated = rows.length > maxParts;
    const page = isTruncated ? rows.slice(0, maxParts) : rows;
    const nextMarker = isTruncated ? page[page.length - 1].partNumber : undefined;

    const body = this.serializer.serialize('ListPartsResult', {
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      StorageClass: 'STANDARD',
      PartNumberMarker: marker,
      MaxParts: maxParts,
      IsTruncated: isTruncated,
      ...(nextMarker !== undefined ? { NextPartNumberMarker: nextMarker } : {}),
      Part: page.map((p) => ({
        PartNumber: p.partNumber,
        ETag: `"${p.etag}"`,
        Size: Number(p.size),
        LastModified: p.writtenAt.toISOString(),
      })),
    });
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
    res.status(200).send(body);
    return undefined;
  }

  /** Upsert a multipart_parts row (last-writer-wins per §4.8). */
  private async upsertPart(
    em: EntityManager,
    upload: MultipartUpload,
    partNumber: number,
    size: bigint,
    etag: string,
  ): Promise<void> {
    let part = await em.findOne(MultipartPart, { upload, partNumber });
    if (part) {
      part.size = size;
      part.etag = etag;
      part.writtenAt = new Date();
    } else {
      part = em.create(MultipartPart, { upload, partNumber, size, etag });
    }
    em.persist(part);
    await em.flush();
  }
}

/**
 * Parse a query param as an integer and clamp it to `[min, max]`, falling back
 * to `fallback` for a missing/non-numeric/negative value. Used to bound the
 * ListParts pagination inputs (TASK-2142).
 */
function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
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

/**
 * Strip the surrounding quotes S3 clients wrap around ETags. Handles the
 * XML entity form too (`&quot;`/`&#34;`): the request XML parser runs with
 * processEntities:false for XXE safety, so an SDK that escapes the quotes in the
 * CompleteMultipartUpload body (AWS SDK v3 does) would otherwise fail part
 * matching. Decoding the quote entity here is safe (etag-only, no XXE surface).
 */
function dequote(etag: string): string {
  return etag.replace(/&quot;|&#34;/g, '"').replace(/^"|"$/g, '');
}
