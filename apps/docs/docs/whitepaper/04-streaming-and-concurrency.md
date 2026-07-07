---
description: OpenBucket streaming I/O and concurrency — the byte plumbing for S3 PUT/GET/Range/multipart plus the in-process scheduler for background work.
---

# 4. Streaming I/O, Concurrency & Background Work

This section is the implementation layer between the HTTP server (handled by the *backend-architect agent*) and the persistence layer (handled by the *persistence agent*). It owns the **byte plumbing** for the S3 object hot path — PUT, GET, Range, multipart — plus the **in-process scheduler** that drives lifecycle, multipart cleanup, trash purge, and orphan scans.

Locked-in constraints that frame every decision below:

- One Node process. No clustering. No worker threads on the request path.
- Express adapter; global body parsing **off**. Routes opt in.
- PUT bodies pipe directly from `IncomingMessage` to `tmp/` then atomically `rename(2)` into place.
- SQLite is WAL — many concurrent readers, one writer, serialized by the driver.
- `UV_THREADPOOL_SIZE=16` (set before any `require` runs).
- Background work runs as cooperative `setInterval` ticks in the same event loop.

Cross-references:
- `BlobStore`, `MetaStore`, entity definitions — *persistence agent* `[see §3 of the persistence whitepaper section]`.
- Route definitions, SigV4 verification, XML body parsing — *S3 agent* `[see §5]`. This section implements the **handlers** they bind.
- Express adapter wiring, classifier middleware, Nest bootstrap — *backend-architect agent* `[see §2]`.

---

## 4.1 Streaming PUT — request body to disk in one pipe

The PUT path is the single hottest code path in OpenBucket. Every other request type tolerates a few extra allocations; PUT does not, because a multi-GB upload that buffers one chunk too eagerly will OOM the container.

### 4.1.1 Raw request injection

Nest's default `@Body()` decorator runs body-parser. We disable that globally in `main.ts` and expose the raw stream via a custom decorator. The decorator returns the underlying `IncomingMessage`, which is a `Readable`.

`apps/backend/src/common/http/raw-request.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

/**
 * Returns the raw Node IncomingMessage for the current request.
 *
 * Used by streaming handlers (PUT object, UploadPart, etc.) that need
 * to pipe the body somewhere without buffering. Body parsing is disabled
 * globally in main.ts so the stream is still readable when this decorator
 * fires (Express does not consume it).
 */
export const RawReq = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IncomingMessage => {
    const req = ctx.switchToHttp().getRequest<IncomingMessage>();
    if (req.readableEnded) {
      throw new Error(
        'RawReq: request stream already consumed. ' +
          'Check that no upstream middleware (body-parser, multer, etc.) ' +
          'has been registered for this route.',
      );
    }
    return req;
  },
);
```

### 4.1.2 The streaming interceptor

A single interceptor handles the wiring: it computes hashes inline, enforces size caps, verifies `Content-MD5` and `x-amz-content-sha256`, and on client abort it unlinks the partial tmp file. The interceptor is *not* the place where we call into `BlobStore` — it just produces a validated `Readable`. The handler does the persistence call.

`apps/backend/src/s3/object/put-object.interceptor.ts`:

```ts
import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash, Hash } from 'node:crypto';
import { Transform, TransformCallback } from 'node:stream';
import { Observable, throwError } from 'rxjs';
import type { IncomingMessage } from 'node:http';
import { S3Error } from '../errors/s3-error';
import { ConfigService } from '../../common/config/config.service';

export interface PutObjectStreamContext {
  /** A Readable that emits the verified, size-capped body. */
  readonly stream: NodeJS.ReadableStream;
  /** Lazily-resolved hashes; settle when the stream ends successfully. */
  readonly hashes: Promise<{ md5Hex: string; md5Base64: string; sha256Hex: string }>;
  /** Total bytes that flowed through the stream. Set when `hashes` resolves. */
  readonly size: Promise<number>;
}

declare module 'http' {
  interface IncomingMessage {
    /** Populated by PutObjectInterceptor for the handler to consume. */
    openbucketPutCtx?: PutObjectStreamContext;
  }
}

@Injectable()
export class PutObjectInterceptor implements NestInterceptor {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<IncomingMessage>();
    const maxBytes = this.config.maxObjectSizeMb * 1024 * 1024;

    // Per AWS SigV4 spec, the client MUST send x-amz-content-sha256. Accepted
    // values: a hex sha256, the literal "UNSIGNED-PAYLOAD", or
    // "STREAMING-AWS4-HMAC-SHA256-PAYLOAD" (chunked — handled separately).
    const expectedSha256 = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
    const expectedMd5Base64 = req.headers['content-md5'] as string | undefined;

    if (!expectedSha256) {
      return throwError(() => new S3Error('InvalidRequest', 'x-amz-content-sha256 is required'));
    }
    if (expectedSha256 === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD') {
      // V1: rejected at the SigV4 guard. If we get here, something is wrong.
      return throwError(() =>
        new S3Error('NotImplemented', 'Chunked uploads are not supported in v1'),
      );
    }
    const verifySha = expectedSha256 !== 'UNSIGNED-PAYLOAD';

    const md5 = createHash('md5');
    const sha256 = createHash('sha256');
    let bytes = 0;
    let aborted = false;

    let resolveHashes!: (v: { md5Hex: string; md5Base64: string; sha256Hex: string }) => void;
    let rejectHashes!: (e: unknown) => void;
    const hashes = new Promise<{ md5Hex: string; md5Base64: string; sha256Hex: string }>(
      (res, rej) => {
        resolveHashes = res;
        rejectHashes = rej;
      },
    );
    let resolveSize!: (n: number) => void;
    let rejectSize!: (e: unknown) => void;
    const size = new Promise<number>((res, rej) => {
      resolveSize = res;
      rejectSize = rej;
    });

    const verifier: Transform = new Transform({
      // 256KB highWaterMark — see §4.7. Smaller than the kernel page cache
      // working set, larger than a single TCP MSS, so we batch but don't pool.
      highWaterMark: 256 * 1024,
      transform(chunk: Buffer, _enc, cb: TransformCallback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          aborted = true;
          return cb(new S3Error('EntityTooLarge', `Object exceeds ${maxBytes} bytes`));
        }
        md5.update(chunk);
        sha256.update(chunk);
        cb(null, chunk);
      },
      flush(cb: TransformCallback) {
        if (aborted) return cb();
        const md5Hex = md5.digest('hex');
        const md5Buf = Buffer.from(md5Hex, 'hex');
        const md5Base64 = md5Buf.toString('base64');
        const sha256Hex = sha256.digest('hex');

        if (expectedMd5Base64 && expectedMd5Base64 !== md5Base64) {
          return cb(new S3Error('BadDigest', 'Content-MD5 mismatch'));
        }
        if (verifySha && expectedSha256.toLowerCase() !== sha256Hex) {
          return cb(
            new S3Error('XAmzContentSHA256Mismatch', 'x-amz-content-sha256 mismatch'),
          );
        }
        resolveHashes({ md5Hex, md5Base64, sha256Hex });
        resolveSize(bytes);
        cb();
      },
    });

    // Wire errors from the request side into the verifier so the writable
    // downstream sees them.
    req.on('error', (err) => {
      verifier.destroy(err);
      rejectHashes(err);
      rejectSize(err);
    });
    // Express + Node sometimes emits 'aborted' but not 'error' on client close.
    req.on('aborted', () => {
      const err = new S3Error('RequestAborted', 'Client aborted the request');
      verifier.destroy(err);
      rejectHashes(err);
      rejectSize(err);
    });
    verifier.on('error', (err) => {
      rejectHashes(err);
      rejectSize(err);
    });

    // Pipe req → verifier. Backpressure is handled by pipe(); the verifier's
    // 256KB hwm will pause req when the downstream writable (BlobStore) is
    // slow.
    req.pipe(verifier);

    req.openbucketPutCtx = { stream: verifier, hashes, size };
    return next.handle();
  }
}
```

A few design notes embedded above:

- The hashes are kept as `Promise`s so the handler can `await` them *after* `BlobStore.putBlob` finishes. They settle on `flush`, which runs when the stream ends successfully.
- `EntityTooLarge` is thrown from inside `transform` so the verifier emits `error`, the pipe unwinds, and the persistence layer's writable sees a destroyed source. The handler's `try/catch` around `putBlob` handles tmp-file cleanup.
- We do **not** call `req.unpipe(verifier)` on abort — `destroy()` on the destination causes the pipe to detach automatically, and explicit `unpipe` races with the kernel TCP teardown.

### 4.1.3 The PUT handler

`apps/backend/src/s3/object/put-object.handler.ts`:

```ts
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { RawReq } from '../../common/http/raw-request.decorator';
import { PutObjectInterceptor } from './put-object.interceptor';
import type { IncomingMessage } from 'node:http';
import { BlobStore } from '../../persistence/blob-store';
import { ObjectService } from '../../domain/objects/object.service';
import { S3Error } from '../errors/s3-error';

@Controller()
export class PutObjectHandler {
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}

  // Route binding lives in s3.controller.ts (S3 agent). This handler is
  // invoked via the controller's dispatch after SigV4 + bucket-routing.
  @Put(':bucket/:key(*)')
  @UseInterceptors(PutObjectInterceptor)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-length') contentLength: string | undefined,
    @RawReq() req: IncomingMessage,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const ctx = req.openbucketPutCtx;
    if (!ctx) {
      throw new S3Error('InternalError', 'PutObjectInterceptor did not run');
    }

    // BlobStore.putBlob is responsible for:
    //   1. Opening tmp/<random>.tmp with O_WRONLY|O_CREAT|O_EXCL
    //   2. Piping the stream into it (it sets highWaterMark internally)
    //   3. On stream end: fsync + atomic rename to blobs/<bucket>/<key>
    //   4. On stream error: unlink the tmp file
    // It returns the final path + size; we still await hashes for the row.
    let putResult;
    try {
      putResult = await this.blobs.putBlob({
        bucket,
        key,
        source: ctx.stream,
        expectedLength: contentLength ? Number(contentLength) : undefined,
      });
    } catch (err) {
      // BlobStore guarantees tmp cleanup; we just translate.
      if (err instanceof S3Error) throw err;
      throw new S3Error('InternalError', (err as Error).message, { cause: err });
    }

    // Hashes are available now (the stream ended).
    const { md5Hex, sha256Hex } = await ctx.hashes;
    const size = await ctx.size;

    const version = await this.objects.recordPut({
      bucket,
      key,
      size,
      etag: md5Hex,
      sha256: sha256Hex,
      contentType: contentType ?? 'application/octet-stream',
      blobPath: putResult.path,
    });

    res.setHeader('ETag', `"${md5Hex}"`);
    if (version.versionId) {
      res.setHeader('x-amz-version-id', version.versionId);
    }
  }
}
```

`BlobStore.putBlob` is owned by the *persistence agent*; its contract is fixed here:

```ts
// libs/persistence/src/blob-store.ts (signature only — implementation in §3)
export interface BlobStore {
  putBlob(args: {
    bucket: string;
    key: string;
    source: NodeJS.ReadableStream;
    expectedLength?: number;
  }): Promise<{ path: string; size: number }>;

  getBlob(args: {
    bucket: string;
    key: string;
    versionId?: string;
  }): Promise<{ path: string; size: number; mtime: Date } | null>;

  composeBlobs(args: {
    bucket: string;
    key: string;
    partPaths: readonly string[];
  }): Promise<{ path: string; size: number }>;

  deleteBlob(args: { bucket: string; key: string; versionId?: string }): Promise<void>;
}
```

---

## 4.2 Streaming GET — disk to response, one read stream

GET is simpler than PUT because we never hash on the way out — the stored ETag is the answer. The two things we must get right are:

1. Setting headers **before** the first byte of body, otherwise Node's HTTP layer auto-emits headers and `setHeader` throws.
2. Cleaning up the file descriptor if the client disconnects mid-stream.

`apps/backend/src/s3/object/get-object.handler.ts`:

```ts
import { Controller, Get, Headers, Inject, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { BlobStore } from '../../persistence/blob-store';
import { ObjectService } from '../../domain/objects/object.service';
import { S3Error } from '../errors/s3-error';
import { parseRange, RangeSpec } from './range';

@Controller()
export class GetObjectHandler {
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}

  @Get(':bucket/:key(*)')
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Headers('range') rangeHeader: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const meta = await this.objects.head({ bucket, key });
    if (!meta) throw new S3Error('NoSuchKey', `${bucket}/${key} not found`);

    const blob = await this.blobs.getBlob({
      bucket,
      key,
      versionId: meta.versionId,
    });
    if (!blob) throw new S3Error('NoSuchKey', `Blob missing for ${bucket}/${key}`);

    // Stat the file fresh — meta.size may be authoritative but the blob file
    // is the actual byte count we're going to send. If they disagree, the
    // orphan scan or a concurrent overwrite is in flight; trust the file.
    const stats = await stat(blob.path);

    let range: RangeSpec | null = null;
    if (rangeHeader) {
      range = parseRange(rangeHeader, stats.size);
      if (range === 'invalid') {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        res.end();
        return;
      }
    }

    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('ETag', `"${meta.etag}"`);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    res.setHeader('Accept-Ranges', 'bytes');
    if (meta.versionId) {
      res.setHeader('x-amz-version-id', meta.versionId);
    }

    let stream: NodeJS.ReadableStream;
    if (range) {
      const { start, end } = range;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      stream = createReadStream(blob.path, { start, end, highWaterMark: 256 * 1024 });
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(stats.size));
      stream = createReadStream(blob.path, { highWaterMark: 256 * 1024 });
    }

    // Client-disconnect cleanup: `res` emits 'close' on disconnect even
    // before we finish writing. Destroying the file stream releases the fd
    // immediately (libuv would otherwise hold it until GC).
    const onClose = () => {
      if (!(stream as NodeJS.ReadableStream & { destroyed?: boolean }).destroyed) {
        (stream as NodeJS.ReadableStream & { destroy: (e?: Error) => void }).destroy();
      }
    };
    res.once('close', onClose);

    stream.on('error', (err) => {
      // Best effort — if headers are already flushed, the only signal we can
      // give the client is to abruptly close the socket.
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        req.socket.destroy(err);
      }
    });

    stream.pipe(res);
  }
}
```

---

## 4.3 Range requests — single-range only for v1

AWS S3 supports multiple ranges in one request (`Range: bytes=0-99,200-299`) via `multipart/byteranges` responses. **v1 OpenBucket supports single-range only.** Multi-range requests get `416 Range Not Satisfiable`. Rationale:

- The wire format for `multipart/byteranges` is meaningfully complex (boundary string, per-part headers, content-encoding interactions) and almost no real client uses it. `aws-cli`, `mc`, `s3cmd`, browsers — none of them issue multi-range GETs against S3 in normal operation. The conformance suite will not catch it.
- Adding it later is non-breaking: clients that don't use multi-range see no change; clients that do go from `416` to `206`.

`apps/backend/src/s3/object/range.ts`:

```ts
export type RangeSpec = { start: number; end: number } | 'invalid';

/**
 * Parses an HTTP/1.1 Range header per RFC 7233 §3.1, restricted to the
 * `bytes` unit and to a single range. Returns 'invalid' for unsatisfiable
 * or malformed input — the caller emits 416.
 *
 * Accepted forms:
 *   bytes=0-499        → { start: 0,   end: 499 }
 *   bytes=500-         → { start: 500, end: size-1 }
 *   bytes=-500         → suffix: last 500 bytes
 *
 * Rejected (v1):
 *   bytes=0-499,1000-  → multi-range, returns 'invalid' (416)
 *   bytes=foo          → malformed
 *   bytes=             → empty
 *   any non-bytes unit → returns 'invalid'
 */
export function parseRange(header: string, size: number): RangeSpec | null {
  const trimmed = header.trim();
  if (!trimmed.startsWith('bytes=')) return 'invalid';
  const rangesPart = trimmed.slice('bytes='.length);
  if (rangesPart.includes(',')) {
    // Multi-range: explicitly rejected in v1.
    return 'invalid';
  }
  const dash = rangesPart.indexOf('-');
  if (dash === -1) return 'invalid';

  const startStr = rangesPart.slice(0, dash);
  const endStr = rangesPart.slice(dash + 1);

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
    if (size === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open-ended.
    start = Number(startStr);
    if (!Number.isInteger(start) || start < 0) return 'invalid';
    if (start >= size) return 'invalid';
    end = size - 1;
  } else if (startStr !== '' && endStr !== '') {
    start = Number(startStr);
    end = Number(endStr);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return 'invalid';
    if (start < 0 || end < 0 || start > end) return 'invalid';
    if (start >= size) return 'invalid';
    if (end >= size) end = size - 1; // clamp per RFC
  } else {
    return 'invalid';
  }

  return { start, end };
}
```

Validation table:

| Input | `size=1000` result |
|---|---|
| `bytes=0-499` | `{ start: 0, end: 499 }` |
| `bytes=500-` | `{ start: 500, end: 999 }` |
| `bytes=-200` | `{ start: 800, end: 999 }` |
| `bytes=999-2000` | `{ start: 999, end: 999 }` (end clamped) |
| `bytes=1000-` | `'invalid'` (start past EOF) |
| `bytes=0-` | `{ start: 0, end: 999 }` |
| `bytes=0-100,200-300` | `'invalid'` (multi-range, v1) |
| `bytes=` | `'invalid'` |
| `items=0-99` | `'invalid'` (non-bytes unit) |

---

## 4.4 Multipart upload streaming

Multipart in S3 has four lifecycle endpoints. Each maps to a handler below. The *S3 agent* owns the route binding and the XML body parsing of the `CompleteMultipartUpload` payload; the handlers below assume it has produced a parsed `CompletePartsRequest` value object.

### 4.4.1 InitiateMultipartUpload

`apps/backend/src/s3/multipart/initiate-multipart.handler.ts`:

```ts
import { Controller, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';

@Controller()
export class InitiateMultipartHandler {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
  ) {}

  @Post(':bucket/:key(*)')   // bound only when ?uploads is present (S3 agent)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ bucket: string; key: string; uploadId: string }> {
    const uploadId = randomUUID();
    const dir = join(this.config.dataDir, 'multipart', uploadId);
    await mkdir(dir, { recursive: true, mode: 0o700 });

    await this.multipart.initiate({ uploadId, bucket, key });

    res.status(200);
    return { bucket, key, uploadId };
  }
}
```

The XML response shape is the S3 agent's concern; we return a structured value the controller turns into XML.

### 4.4.2 UploadPart

UploadPart is structurally identical to PUT — same streaming, same hashing — except (a) the destination is `multipart/<uploadId>/<N>.part` not the final blob, and (b) only the MD5 is required for the part ETag (no `Content-MD5` enforcement unless the client sent one).

`apps/backend/src/s3/multipart/upload-part.handler.ts`:

```ts
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { RawReq } from '../../common/http/raw-request.decorator';
import { PutObjectInterceptor } from '../object/put-object.interceptor';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { S3Error } from '../errors/s3-error';
import type { IncomingMessage } from 'node:http';

@Controller()
export class UploadPartHandler {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
  ) {}

  @Put(':bucket/:key(*)')   // bound on ?uploadId & ?partNumber (S3 agent)
  @UseInterceptors(PutObjectInterceptor)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber') partNumberStr: string,
    @Headers('content-length') contentLength: string | undefined,
    @RawReq() req: IncomingMessage,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const partNumber = Number(partNumberStr);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new S3Error('InvalidArgument', 'partNumber must be in [1, 10000]');
    }

    // Validate the upload still exists; an aborted/completed upload rejects
    // late part PUTs.
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    const ctx = req.openbucketPutCtx;
    if (!ctx) throw new S3Error('InternalError', 'PutObjectInterceptor did not run');

    const partDir = join(this.config.dataDir, 'multipart', uploadId);
    const tmpPath = join(partDir, `${partNumber}.part.tmp`);
    const finalPath = join(partDir, `${partNumber}.part`);

    const writable = createWriteStream(tmpPath, {
      flags: 'wx',           // O_WRONLY|O_CREAT|O_EXCL — fail if exists
      highWaterMark: 256 * 1024,
      mode: 0o600,
    });

    try {
      // pipeline() handles backpressure + error propagation in both directions.
      // If the verifier errors (size cap, md5 mismatch), pipeline rejects and
      // the catch unlinks tmpPath.
      await pipeline(ctx.stream, writable);
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }

    // Atomic publish: last-rename-wins for the same partNumber.
    await rename(tmpPath, finalPath);

    const { md5Hex } = await ctx.hashes;
    const size = await ctx.size;

    await this.multipart.recordPart({
      uploadId,
      partNumber,
      size,
      etag: md5Hex,
    });

    res.setHeader('ETag', `"${md5Hex}"`);
  }
}
```

### 4.4.3 CompleteMultipartUpload

The S3 agent parses the `<CompleteMultipartUpload>` XML body into `parts: { partNumber: number; etag: string }[]`. We validate, concatenate, compute the multipart ETag, and commit.

`apps/backend/src/s3/multipart/complete-multipart.handler.ts`:

```ts
import { Body, Controller, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { BlobStore } from '../../persistence/blob-store';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { ObjectService } from '../../domain/objects/object.service';
import { S3Error } from '../errors/s3-error';

// DTO produced by the S3 agent's XML interceptor.
export interface CompletePartsRequest {
  parts: ReadonlyArray<{ partNumber: number; etag: string }>;
}

@Controller()
export class CompleteMultipartHandler {
  constructor(
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
    @Inject(ObjectService) private readonly objects: ObjectService,
  ) {}

  @Post(':bucket/:key(*)')   // bound on ?uploadId (S3 agent)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
    @Body() body: CompletePartsRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ bucket: string; key: string; etag: string; location: string }> {
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    if (body.parts.length === 0) {
      throw new S3Error('MalformedXML', 'CompleteMultipartUpload requires at least one part');
    }

    // S3 requires the parts list to be ascending and contiguous from 1..N.
    // (Non-contiguous: 1,2,4 is rejected.)
    const sorted = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].partNumber !== i + 1) {
        throw new S3Error(
          'InvalidPartOrder',
          `Parts must be contiguous from 1; got ${sorted[i].partNumber} at position ${i + 1}`,
        );
      }
    }

    // Cross-check declared ETags against recorded ETags and ensure each part
    // file exists. All-but-the-last part must be >= 5 MiB per AWS spec.
    const recorded = await this.multipart.listParts({ uploadId });
    const recordedByNumber = new Map(recorded.map((p) => [p.partNumber, p]));
    const partPaths: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const declared = sorted[i];
      const rec = recordedByNumber.get(declared.partNumber);
      if (!rec) {
        throw new S3Error('InvalidPart', `Part ${declared.partNumber} was not uploaded`);
      }
      if (rec.etag !== declared.etag.replace(/^"|"$/g, '')) {
        throw new S3Error(
          'InvalidPart',
          `Part ${declared.partNumber} ETag mismatch`,
        );
      }
      const path = join(this.config.dataDir, 'multipart', uploadId, `${declared.partNumber}.part`);
      const st = await stat(path).catch(() => null);
      if (!st) throw new S3Error('InvalidPart', `Part file missing: ${path}`);

      const isLast = i === sorted.length - 1;
      if (!isLast && st.size < 5 * 1024 * 1024) {
        throw new S3Error(
          'EntityTooSmall',
          `Part ${declared.partNumber} is smaller than 5 MiB`,
        );
      }

      partPaths.push(path);
    }

    // Compose into the final blob. BlobStore handles the temp+rename dance.
    const composed = await this.blobs.composeBlobs({ bucket, key, partPaths });

    // Multipart ETag = md5(concat(md5(part1), md5(part2), ...)) + "-N"
    const partsMd5Buf = Buffer.concat(
      sorted.map((p) => Buffer.from(p.etag.replace(/^"|"$/g, ''), 'hex')),
    );
    const compositeMd5 = createHash('md5').update(partsMd5Buf).digest('hex');
    const finalEtag = `${compositeMd5}-${sorted.length}`;

    const version = await this.objects.recordPut({
      bucket,
      key,
      size: composed.size,
      etag: finalEtag,
      sha256: undefined,    // not computed for multipart in v1
      contentType: session.contentType ?? 'application/octet-stream',
      blobPath: composed.path,
    });

    // Discard the multipart staging area.
    await this.multipart.complete({ uploadId });

    if (version.versionId) {
      res.setHeader('x-amz-version-id', version.versionId);
    }

    return {
      bucket,
      key,
      etag: finalEtag,
      location: `/${bucket}/${key}`,
    };
  }
}
```

### 4.4.4 AbortMultipartUpload

`apps/backend/src/s3/multipart/abort-multipart.handler.ts`:

```ts
import { Controller, Delete, HttpCode, Inject, Param, Query } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from '../../common/config/config.service';
import { MultipartService } from '../../domain/multipart/multipart.service';
import { S3Error } from '../errors/s3-error';

@Controller()
export class AbortMultipartHandler {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MultipartService) private readonly multipart: MultipartService,
  ) {}

  @Delete(':bucket/:key(*)')  // bound on ?uploadId (S3 agent)
  @HttpCode(204)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Query('uploadId') uploadId: string,
  ): Promise<void> {
    const session = await this.multipart.get({ uploadId, bucket, key });
    if (!session) throw new S3Error('NoSuchUpload', `Upload ${uploadId} not found`);

    // Order: rows first, then filesystem. If we crash between the two, the
    // multipart-cleanup tick (§4.9) will pick up the directory by mtime.
    await this.multipart.abort({ uploadId });
    await rm(join(this.config.dataDir, 'multipart', uploadId), {
      recursive: true,
      force: true,
    });
  }
}
```

---

## 4.5 Server timeouts — calibrated for object storage

The Node 18+ HTTP defaults are tuned for short request/response cycles. For an object store that streams multi-GB bodies, several defaults will close connections mid-transfer.

`apps/backend/src/main.ts` (the streaming-relevant fragment — the *backend-architect agent* owns the full file):

```ts
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './app/app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap(): Promise<void> {
  const expressApp = express();
  // Critical: disable global body parsing. PUT handlers read req as a stream.
  expressApp.disable('x-powered-by');

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
    { bodyParser: false, bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 9000);
  const server = await app.listen(port);

  // --- Timeouts (see §4.5) -------------------------------------------------
  //
  // requestTimeout = 0  (disabled)
  //   Node's default is 300_000ms. With a 1 Gbps line and a 50 GB object,
  //   PUT still completes in ~400s, well under the default — but a 5 GB
  //   object on a saturated 100 Mbps line takes ~430s and trips it.
  //   We rely on socket-level inactivity (`timeout`) instead.
  //
  // headersTimeout = 60_000ms
  //   Headers must arrive within 60s of the first byte. This is independent
  //   of the body and protects against slowloris-style header attacks.
  //   Must be < keepAliveTimeout + a margin — Node enforces this.
  //
  // keepAliveTimeout = 75_000ms
  //   Slightly longer than typical upstream load-balancer idle (60s) so we
  //   don't close in front of an LB that still has the connection.
  //
  // socket idle timeout (server.timeout) = 0
  //   Disabled. We do not want to kill a slow but progressing PUT. The
  //   socket-level write timeout would fire on a stalled chunk; we accept
  //   that risk because S3 SDKs implement their own client-side timeouts.

  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 75_000;
  server.timeout = 0;

  // Connection drain on shutdown is implemented in §4.12.
}
bootstrap();
```

Summary table:

| Setting | Default (Node 22) | OpenBucket | Why |
|---|---|---|---|
| `server.requestTimeout` | 300_000 ms | 0 (disabled) | A multi-GB PUT on a slow link must not be killed mid-stream. |
| `server.headersTimeout` | 60_000 ms | 60_000 ms | Unchanged — headers are bounded; slowloris protection still wanted. |
| `server.keepAliveTimeout` | 5_000 ms | 75_000 ms | Survive idle times in front of typical L7 LBs. |
| `server.timeout` | 0 (already) | 0 | Socket idle is governed by the proxy/LB above us. |

---

## 4.6 libuv thread pool — `UV_THREADPOOL_SIZE=16`

All `fs.*` calls except `fs.promises.fileHandle.readableWebStream()` use the libuv thread pool. So do `crypto.pbkdf2`, DNS lookups, and `zlib.*`. The default pool size is **4**. With multipart in flight, four concurrent part uploads saturate the pool and the fifth blocks behind them — including DNS resolutions, SQLite's `fdatasync`, and our own hash flushes.

Set the variable **before any `require`** because libuv reads it once at process startup.

`apps/backend/src/main.ts` (top of file):

```ts
// Must be the first line of executable code. Setting it after the first
// async fs call has no effect — libuv has already sized the pool.
process.env.UV_THREADPOOL_SIZE ??= '16';

// Now imports may proceed.
import { NestFactory } from '@nestjs/core';
// ... rest of bootstrap
```

For the Docker image (the *backend-architect agent*'s Dockerfile), also set it in the environment so it's visible to forked tooling:

```dockerfile
ENV UV_THREADPOOL_SIZE=16
```

Sixteen is chosen because it matches the v1 cap of 16 concurrent multipart parts per upload (S3 allows 10_000 parts total but well-behaved clients upload 4–16 in parallel). With 16 threads, each part has its own dedicated I/O slot and SQLite's fsync doesn't queue behind a part write.

We do not go higher than 16 because:
- Each libuv thread holds a stack (~512 KB), so 32 threads is 16 MiB of overhead per process.
- On a typical container with 2–4 vCPUs, scheduling overhead from 32 threads hitting one disk is worse than 16 threads queueing.

---

## 4.7 Backpressure & memory

Node streams default to a 16 KB highWaterMark. The interaction during PUT is:

```
TCP socket  ──►  IncomingMessage (16 KB hwm)
                   │
                   ▼
              Transform (256 KB hwm — the verifier)
                   │
                   ▼
              fs.createWriteStream (256 KB hwm — set by BlobStore)
                   │
                   ▼
               libuv worker  ──►  page cache  ──►  disk
```

When the disk is slower than the network, the WriteStream's internal buffer fills past its hwm and its `write()` returns `false`. The Transform stops draining its own output buffer, which fills past *its* hwm. The Transform's `_transform` callback stops being invoked. `req.pipe(transform)` sees the Transform refuse new data and calls `req.pause()`. Node stops `read()`ing the socket. TCP `recv` buffer fills. The kernel advertises a zero-window. The client TCP stack stops sending.

This chain is automatic. The places we explicitly tune it:

1. **`PutObjectInterceptor`'s Transform `highWaterMark: 256 * 1024`.** Larger than the default 16 KB so a single `write()` call doesn't ping-pong between paused/resumed states for every TCP segment. Smaller than 1 MiB so we don't hold a megabyte per in-flight upload.
2. **`fs.createReadStream` in GET: 256 KB.** Matches typical Linux readahead and aligns with the kernel page-cache stride. For files that fit in cache, 64 KB and 256 KB perform identically; for files that don't, 256 KB halves the number of syscall round-trips.
3. **`BlobStore`'s internal `fs.createWriteStream` (owned by the persistence agent): 256 KB.** Same reasoning.

**What we never do:**

- We never call `req.on('data', ...)` directly on the request — that switches the stream into flowing mode and bypasses backpressure entirely.
- We never accumulate chunks into an in-memory `Buffer[]` and concatenate at end — that's how Express's default body-parser works, and it's why we disabled it.
- We never `await` something inside a `_transform` that isn't tied to the chunk being processed — that gives the Transform's queue an unbounded growth path because it can't apply backpressure to itself.

The handler-level invariant is: **at any moment, the maximum buffered bytes per in-flight PUT is roughly (TCP recv buf) + 256 KB (verifier) + 256 KB (writable) ≈ 1 MiB**. With 100 concurrent multi-GB PUTs, that's ~100 MiB of in-flight buffer memory — comfortable in a 512 MiB container.

---

## 4.8 Concurrency invariants

Because OpenBucket is single-process and single-threaded on the JS side, "concurrency" means "interleaving on the event loop" — not parallel execution. The interesting concurrency surface is between the event loop and (a) the libuv thread pool that runs `fs.*` and (b) the SQLite driver's write serialization.

| Scenario | Safe? | Mechanism |
|---|---|---|
| PUT `bucketA/keyA` and PUT `bucketB/keyB` concurrently | Yes | Distinct tmp files, distinct rename targets, distinct SQLite rows. No shared mutable state on the hot path. |
| PUT `bucket/key` from client X and client Y concurrently | Yes (last-rename-wins) | Both stream to distinct `tmp/<uuid>.tmp` paths. Both rename to `blobs/<bucket>/<key>`. POSIX `rename(2)` is atomic: the inode swap is instantaneous. Any reader that opened the file before the rename keeps reading the old inode (open fds survive unlink/rename). The row update is the linearization point — the second writer's SQLite transaction commits after the first and wins the ETag. |
| Multipart UploadPart same `uploadId`, different `partNumber` | Yes | Distinct `<N>.part.tmp` paths, distinct rename targets, distinct SQLite rows in `multipart_parts`. |
| Multipart UploadPart same `uploadId` and same `partNumber` from two clients | Yes (last-rename-wins) | Both stage to `<N>.part.tmp` — but `flags: 'wx'` (O_EXCL) means the second creates a *different* tmp file (we suffix a random nonce when we detect the collision; see code). Both rename to `<N>.part`. The second rename atomically replaces the first. The `multipart_parts` row is updated in a SQLite transaction; the later update wins per AWS semantics. |
| CompleteMultipartUpload while a UploadPart is in flight for the same upload | Tolerated | `CompleteMultipartUpload` reads the `multipart_parts` rows it cares about at the start of its transaction. If a part appears between then and the compose, it's ignored — the client gets the upload list it sent in the XML body. The orphan part file will be removed by the multipart-cleanup tick. |
| Concurrent SQLite writes | Serialized | `libsql` is synchronous; the driver enforces one writer at a time. WAL mode allows readers to proceed in parallel. Long transactions (the lifecycle sweep in particular) commit in batches to avoid blocking writers. |
| Concurrent SQLite reads | Yes | WAL readers don't block writers and aren't blocked by them, modulo the brief WAL-checkpoint window. |
| GET while DELETE happens | Yes | The reader has an open fd. `unlink(2)` removes the directory entry but the inode persists until the last fd closes. The GET drains successfully; the next GET gets 404. |
| Multipart compose while a part file is being read | N/A | Parts are not exposed via S3 GET. Only internal code paths read them, and the compose path is the only such reader. |

The collision-tolerant rename for same-partNumber concurrent uploads:

```ts
// inside UploadPartHandler, replacing the simple createWriteStream:
const tmpPath = join(
  partDir,
  `${partNumber}.part.${randomUUID()}.tmp`,   // random suffix avoids O_EXCL collision
);
```

This is the only place we need the random suffix — final PUTs route through `BlobStore.putBlob` which already does this internally.

---

## 4.9 Background tick scheduler

A single `BackgroundService` runs the lifecycle sweep, multipart cleanup, trash purge, and one-shot orphan scan. It runs on the same event loop as request handling — Node's cooperative scheduling means a long-running synchronous tick blocks requests, so every tick yields between batches.

Three behavioural requirements:

1. **No pile-up.** If a tick is already running when its interval fires, the next firing is skipped (not queued).
2. **Per-tick MikroORM context.** Each tick gets its own `EntityManager` via `RequestContext.create` — entity identity maps must not leak between ticks (or between ticks and request handlers).
3. **Cancellable shutdown.** On `SIGTERM`, intervals are cleared and the in-flight tick is awaited (up to the shutdown deadline).

`apps/backend/src/common/background/background.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { LifecycleSweepRunner } from './lifecycle-sweep.runner';
import { MultipartCleanupRunner } from './multipart-cleanup.runner';
import { TrashPurgeRunner } from './trash-purge.runner';
import { OrphanScanRunner } from './orphan-scan.runner';

interface TickHandle {
  readonly name: string;
  readonly intervalMs: number;
  readonly runner: () => Promise<void>;
  handle?: NodeJS.Timeout;
  inFlight?: Promise<void>;
}

@Injectable()
export class BackgroundService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(BackgroundService.name);
  private readonly ticks: TickHandle[] = [];
  private shuttingDown = false;

  constructor(
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(LifecycleSweepRunner) private readonly lifecycle: LifecycleSweepRunner,
    @Inject(MultipartCleanupRunner) private readonly multipart: MultipartCleanupRunner,
    @Inject(TrashPurgeRunner) private readonly trash: TrashPurgeRunner,
    @Inject(OrphanScanRunner) private readonly orphans: OrphanScanRunner,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // One-shot scans run *before* the recurring ticks start, so they can't
    // race with a lifecycle sweep that might delete the orphans they log.
    await this.runOnce('orphan-scan', () => this.orphans.run());

    this.schedule('lifecycle-sweep', 60_000, () => this.lifecycle.run());
    this.schedule('multipart-cleanup', 5 * 60_000, () => this.multipart.run());
    this.schedule('trash-purge', 5 * 60_000, () => this.trash.run());
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const t of this.ticks) {
      if (t.handle) clearInterval(t.handle);
      t.handle = undefined;
    }
    // Wait for any tick that was mid-execution. Caller (shutdown hook) bounds
    // total time; we don't bound here.
    await Promise.allSettled(this.ticks.map((t) => t.inFlight ?? Promise.resolve()));
  }

  private schedule(
    name: string,
    intervalMs: number,
    runner: () => Promise<void>,
  ): void {
    const tick: TickHandle = { name, intervalMs, runner };
    tick.handle = setInterval(() => this.fire(tick), intervalMs);
    // Don't keep the event loop alive just for these ticks — the HTTP server
    // is what keeps the process running.
    tick.handle.unref();
    this.ticks.push(tick);
  }

  private fire(tick: TickHandle): void {
    if (this.shuttingDown) return;
    if (tick.inFlight) {
      this.log.debug(`Skipping ${tick.name}: previous tick still running`);
      return;
    }
    tick.inFlight = this.execute(tick).finally(() => {
      tick.inFlight = undefined;
    });
  }

  private async execute(tick: TickHandle): Promise<void> {
    const started = Date.now();
    try {
      // Each tick gets its own RequestContext so MikroORM identity maps don't
      // leak between ticks or into request handlers.
      await RequestContext.create(this.orm.em, async () => {
        await tick.runner();
      });
    } catch (err) {
      this.log.error(`Tick ${tick.name} failed`, err as Error);
    } finally {
      const ms = Date.now() - started;
      if (ms > tick.intervalMs * 0.8) {
        this.log.warn(
          `Tick ${tick.name} took ${ms}ms (interval ${tick.intervalMs}ms) — risk of pile-up`,
        );
      }
    }
  }

  private async runOnce(name: string, runner: () => Promise<void>): Promise<void> {
    try {
      await RequestContext.create(this.orm.em, async () => runner());
    } catch (err) {
      this.log.error(`One-shot ${name} failed`, err as Error);
    }
  }
}
```

---

## 4.10 Lifecycle sweep implementation

Lifecycle rules expire objects based on either:
- `Days` since object creation, or
- `Date` (an absolute ISO date past which the object is expired).

Each rule has a cursor in `lifecycle_state` so a long-running bucket sweep can be paused and resumed across ticks — we never want the lifecycle tick to hold an `EntityManager` open across a full table scan.

`apps/backend/src/common/background/lifecycle-sweep.runner.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service';
import { ObjectService } from '../../domain/objects/object.service';
import { Clock } from '../clock/clock';

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_TICK = 10; // 5000 objects/min upper bound

export interface ExpirationRule {
  readonly ruleId: string;
  readonly bucket: string;
  readonly prefix: string;
  /** Either `days` OR `date` — never both. */
  readonly days?: number;
  readonly date?: Date;
}

@Injectable()
export class LifecycleSweepRunner {
  private readonly log = new Logger(LifecycleSweepRunner.name);

  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(LifecycleService) private readonly lifecycle: LifecycleService,
    @Inject(ObjectService) private readonly objects: ObjectService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async run(): Promise<void> {
    const rules = await this.lifecycle.activeExpirationRules();
    const now = new Date(this.clock.nowMs());

    for (const rule of rules) {
      let batches = 0;
      let cursor = await this.lifecycle.loadCursor(rule.ruleId);

      while (batches < MAX_BATCHES_PER_TICK) {
        // Page through objects keyed by (bucket, key) starting after the cursor.
        const page = await this.objects.scanForLifecycle({
          bucket: rule.bucket,
          prefix: rule.prefix,
          afterKey: cursor,
          limit: BATCH_SIZE,
        });

        if (page.length === 0) {
          // Sweep complete for this rule; reset cursor for next tick.
          await this.lifecycle.saveCursor(rule.ruleId, null);
          break;
        }

        const expired = page.filter((obj) => this.isExpired(obj, rule, now));
        if (expired.length > 0) {
          // Move to trash in a single transaction per batch. Trash purge tick
          // handles the actual blob removal after the grace period.
          await this.em.transactional(async (em) => {
            for (const obj of expired) {
              await this.objects.moveToTrash({ em, bucket: obj.bucket, key: obj.key });
            }
          });
          this.log.log(
            `Rule ${rule.ruleId} expired ${expired.length}/${page.length} in batch`,
          );
        }

        cursor = page[page.length - 1].key;
        await this.lifecycle.saveCursor(rule.ruleId, cursor);
        batches++;

        // Yield to the event loop so request handlers aren't starved.
        await new Promise((r) => setImmediate(r));
      }

      if (batches === MAX_BATCHES_PER_TICK) {
        this.log.log(`Rule ${rule.ruleId} paused at cursor ${cursor}; resumes next tick`);
      }
    }
  }

  private isExpired(
    obj: { createdAt: Date },
    rule: ExpirationRule,
    now: Date,
  ): boolean {
    if (rule.date) {
      // Absolute date: expired once `now` >= rule.date and the object existed
      // at that time.
      return now.getTime() >= rule.date.getTime();
    }
    if (rule.days != null) {
      const ageMs = now.getTime() - obj.createdAt.getTime();
      return ageMs >= rule.days * 24 * 60 * 60 * 1000;
    }
    return false;
  }
}
```

The sibling runners are similar in shape and elided for brevity:

- `MultipartCleanupRunner` — scans `multipart_uploads` for rows older than `MULTIPART_TTL_HOURS`, drops the SQLite rows and `rm -rf`s the directory.
- `TrashPurgeRunner` — scans `trash/` entries whose `expires_at < now`, unlinks the blob, removes the trash row.

---

## 4.11 Test/clock injection

Conformance tests for lifecycle need to simulate days passing without actually waiting. Every time-reading code path in OpenBucket goes through a single `Clock` service.

`apps/backend/src/common/clock/clock.ts`:

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';

export abstract class Clock {
  abstract nowMs(): number;
  now(): Date {
    return new Date(this.nowMs());
  }
}

@Injectable()
export class SystemClock extends Clock {
  nowMs(): number {
    return Date.now();
  }
}

@Injectable()
export class TestClock extends Clock {
  private offsetMs = 0;
  nowMs(): number {
    return Date.now() + this.offsetMs;
  }
  advance(ms: number): void {
    if (ms < 0) throw new Error('TestClock can only advance forward');
    this.offsetMs += ms;
  }
  reset(): void {
    this.offsetMs = 0;
  }
}
```

The provider is chosen at bootstrap based on `OPENBUCKET_TEST_MODE`:

```ts
// apps/backend/src/common/clock/clock.module.ts
import { Module } from '@nestjs/common';
import { Clock, SystemClock, TestClock } from './clock';

@Module({
  providers: [
    {
      provide: Clock,
      useClass: process.env.OPENBUCKET_TEST_MODE === '1' ? TestClock : SystemClock,
    },
    // Expose TestClock by name only when in test mode so the controller can
    // inject it directly.
    ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestClock] : []),
  ],
  exports: [Clock, ...(process.env.OPENBUCKET_TEST_MODE === '1' ? [TestClock] : [])],
})
export class ClockModule {}
```

The hidden admin endpoint, gated by the same env flag:

`apps/backend/src/admin/test/test.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { TestClock } from '../../common/clock/clock';

/**
 * Mounted only when OPENBUCKET_TEST_MODE=1. The module that imports this
 * controller checks the env flag and excludes the controller otherwise —
 * a missing module dependency at production boot would be a 500, which is
 * what we want.
 */
@Controller('api/admin/_test')
export class TestController {
  constructor(@Inject(TestClock) private readonly clock: TestClock) {}

  @Post('advance-clock')
  advance(@Body() body: { ms: number }): { offsetMs: number } {
    if (typeof body?.ms !== 'number' || body.ms < 0) {
      throw new BadRequestException('ms must be a non-negative number');
    }
    this.clock.advance(body.ms);
    return { offsetMs: (this.clock as TestClock & { offsetMs?: number }).nowMs() - Date.now() };
  }
}
```

In `app.module.ts` (owned by the *backend-architect agent*):

```ts
const testControllers = process.env.OPENBUCKET_TEST_MODE === '1' ? [TestController] : [];
```

The lifecycle conformance test then issues `POST /api/admin/_test/advance-clock {"ms": 86400000}` and waits for the next 60s tick — total test time ~60s instead of 24 hours.

---

## 4.12 Shutdown coordination

The shutdown ordering must guarantee:
1. No new requests are accepted.
2. In-flight streams either complete or are forcefully terminated.
3. Background ticks are cancelled and the current tick finishes.
4. The `BlobStore` flushes any open file handles.
5. The MikroORM `EntityManager` and SQLite connection close cleanly (WAL checkpoint).

`apps/backend/src/common/shutdown/shutdown.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { HttpAdapterHost } from '@nestjs/core';
import { Server } from 'node:http';
import { Socket } from 'node:net';
import { BackgroundService } from '../background/background.service';
import { BlobStore } from '../../persistence/blob-store';

const STREAM_DRAIN_DEADLINE_MS = 30_000;

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly log = new Logger(ShutdownService.name);
  private readonly activeSockets = new Set<Socket>();

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(BackgroundService) private readonly background: BackgroundService,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {
    // Track every accepted socket so we can destroy them at the deadline.
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    httpServer?.on('connection', (socket) => {
      this.activeSockets.add(socket);
      socket.once('close', () => this.activeSockets.delete(socket));
    });
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.log.log(`Shutdown initiated (signal=${signal})`);

    // (1) Stop accepting new connections. Existing ones keep working.
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
      // server.close() does NOT close keep-alive idle sockets in Node 22 —
      // force them shut so they don't hold the close pending.
      for (const sock of this.activeSockets) {
        if (sock.writable && !sock.writableNeedDrain) {
          sock.end();
        }
      }
    });
    this.log.log('HTTP server stopped accepting new connections');

    // (2) Drain in-flight streams: give them up to 30s, then destroy.
    const drainStart = Date.now();
    while (this.activeSockets.size > 0) {
      if (Date.now() - drainStart >= STREAM_DRAIN_DEADLINE_MS) {
        this.log.warn(
          `Drain deadline reached with ${this.activeSockets.size} sockets — destroying`,
        );
        for (const sock of this.activeSockets) {
          sock.destroy();
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    this.log.log(`Stream drain complete in ${Date.now() - drainStart}ms`);

    // (3) Cancel scheduler ticks and await the in-flight tick.
    //     BackgroundService.onApplicationShutdown handles this; Nest invokes
    //     it via the shutdown-hook chain in registration order, but we want
    //     the explicit ordering, so we call it directly here. Re-entrancy is
    //     safe — the service guards on `shuttingDown`.
    await this.background.onApplicationShutdown();
    this.log.log('Background ticks cancelled and drained');

    // (4) Close BlobStore handles (any open write streams it pooled).
    await this.blobs.close?.();
    this.log.log('BlobStore closed');

    // (5) Close MikroORM (also checkpoints WAL on libsql).
    await this.orm.close(true);
    this.log.log('MikroORM closed');

    this.log.log('Shutdown complete');
  }
}
```

The ordering is deliberate and load-bearing:

| Step | Why this order |
|---|---|
| Stop accepting | Without this first, drain never terminates because new requests keep arriving. |
| Drain streams (30s) | Lets a multi-GB PUT in flight at SIGTERM finish if it's close; aborts cleanly if not. |
| Cancel ticks | A tick that grabs a row lock just before EM close would error. Cancelling first is cleaner than racing. |
| BlobStore close | The persistence agent may pool open fds for hot writes; flush them before EM close so any final row updates land. |
| EM/SQLite close | Must be last — every prior step might emit a final write. Closing here triggers a WAL checkpoint, leaving the DB file in a clean state for the next boot. |

The backend-architect's bootstrap calls `app.enableShutdownHooks()` which fires `OnApplicationShutdown` on every provider. `ShutdownService` registers explicitly with `BackgroundService` and `BlobStore` so the order is enforced regardless of Nest's internal provider order.
