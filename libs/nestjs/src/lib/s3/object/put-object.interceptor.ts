import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { Observable, throwError } from 'rxjs';

import { AppConfigService } from '../../common/config/app-config.service';
import {
  EntityTooLargeError,
  IncompleteBodyError,
  InvalidArgumentError,
  InvalidRequestError,
} from '../errors/s3-error';
import type { ChunkSigningContext } from '../sigv4/chunk-signing';
import { createBodyVerifier } from './body-verifier';
import { ChunkedDecoder } from './chunked-decoder';
import { declaredChecksum } from './checksums';

// Re-export the shared verifier types from their historical import site so
// existing consumers (`object.service.ts`, TEST-0301/0316) keep importing them
// from `put-object.interceptor`.
export type { PutObjectHashes, PutObjectStreamContext } from './body-verifier';

/**
 * True for body-streaming PUTs that this interceptor should verify: PutObject
 * and UploadPart (uploadId+partNumber, no copy-source). False for CopyObject /
 * UploadPartCopy (copy-source header) and the sub-resource PUTs, which carry no
 * object body.
 */
function isPutObjectBody(req: IncomingMessage): boolean {
  if (req.headers['x-amz-copy-source'] !== undefined) return false;
  const query = (req as unknown as { query?: Record<string, unknown> }).query ?? {};
  for (const flag of ['tagging', 'acl', 'retention', 'legal-hold']) {
    if (flag in query) return false;
  }
  return true;
}

const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
// Unsigned chunked upload with a trailing checksum — the aws-cli v2 default
// (STORY-0120). No per-chunk signatures; a trailer section follows the body.
const STREAMING_UNSIGNED_TRAILER = 'STREAMING-UNSIGNED-PAYLOAD-TRAILER';
const UNSIGNED = 'UNSIGNED-PAYLOAD';
// 256 KB highWaterMark (§4.7): larger than a TCP MSS so we batch, smaller than
// the page-cache working set so we don't pool.
const HIGH_WATER_MARK = 256 * 1024;

/**
 * PutObjectInterceptor — the streaming PUT verifier (WHITEPAPER §4.1.2).
 *
 * Computes md5 + sha256 inline, enforces the configured size cap, verifies
 * `Content-MD5` and `x-amz-content-sha256`, and on client abort destroys the
 * verifier and rejects the pending hash/size promises. It does NOT call
 * BlobStore — it just produces a validated `Readable` on `req.openbucketPutCtx`
 * for the handler (STORY-0302) to persist.
 */
@Injectable()
export class PutObjectInterceptor implements NestInterceptor {
  /**
   * Idle-stall window for a streaming PUT (TASK-2111, CWE-400). If no body bytes
   * arrive for this long the request is destroyed, so a slow/stalled upload can't
   * pin a socket open. The timer re-arms on every received chunk, so an
   * actively-progressing stream is never cut off (the server-wide
   * `requestTimeout` in main.ts is the coarse backstop; this fires far sooner on
   * a genuine stall).
   */
  static readonly STALL_TIMEOUT_MS = 30_000;

  constructor(private readonly config: AppConfigService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<IncomingMessage>();

    // The object controller dispatches every PUT through one handler; only the
    // terminal PutObject branch streams a body. Skip CopyObject (copy-source
    // header) and the sub-resource PUTs (tagging/acl/retention/legal-hold) and
    // UploadPart (uploadId+partNumber) so their bodies aren't consumed here.
    if (!isPutObjectBody(req)) {
      return next.handle();
    }

    const maxBytes = this.config.maxObjectSizeMb * 1024 * 1024;

    // AWS requires a signed x-amz-content-sha256: a hex digest, UNSIGNED-PAYLOAD,
    // or the chunked sentinel (rejected upstream by SigV4Guard — §2.4.6).
    let expectedSha256 = (req.headers['x-amz-content-sha256'] as string | undefined) ?? '';
    const expectedMd5Base64 = req.headers['content-md5'] as string | undefined;

    if (!expectedSha256) {
      // Presigned PUTs (auth in the query string, §2.5) sign the payload as
      // UNSIGNED-PAYLOAD and routinely omit this header — it isn't one of their
      // SignedHeaders. Default it so they aren't rejected; header-signed PUTs
      // still require it. The presence of X-Amz-Signature is how SigV4Guard
      // itself detects the presigned branch.
      const query = (req as unknown as { query?: Record<string, unknown> }).query ?? {};
      if (typeof query['X-Amz-Signature'] === 'string') {
        expectedSha256 = UNSIGNED;
      } else {
        return throwError(() => new InvalidRequestError('x-amz-content-sha256 is required'));
      }
    }
    // Chunked-upload signing (STORY-0119). SigV4Guard verified the seed
    // signature and stashed the signing context; here we decode the aws-chunked
    // framing and verify the per-chunk chain. Without a stashed context (e.g. a
    // presigned streaming PUT, unsupported) we can't verify the chain — reject.
    const isStreamingSigned = expectedSha256 === STREAMING_SHA;
    const isStreamingUnsignedTrailer = expectedSha256 === STREAMING_UNSIGNED_TRAILER;
    const isStreaming = isStreamingSigned || isStreamingUnsignedTrailer;
    let chunkCtx: ChunkSigningContext | undefined;
    let decodedLength = -1;
    if (isStreaming) {
      if (isStreamingSigned) {
        // Signed chunks need the seed + signing key SigV4Guard stashed. Without
        // it (e.g. a presigned streaming PUT, unsupported) we can't verify the
        // chain — reject. Unsigned-trailer needs no signing context.
        chunkCtx = (
          req as IncomingMessage & { openbucket?: { chunkSigning?: ChunkSigningContext } }
        ).openbucket?.chunkSigning;
        if (!chunkCtx) {
          return throwError(
            () =>
              new InvalidArgumentError(
                'STREAMING-AWS4-HMAC-SHA256-PAYLOAD is only supported for header-signed requests.',
                'x-amz-content-sha256',
                STREAMING_SHA,
              ),
          );
        }
      }
      const rawLen = req.headers['x-amz-decoded-content-length'];
      decodedLength = Number(Array.isArray(rawLen) ? rawLen[0] : rawLen);
      if (!Number.isInteger(decodedLength) || decodedLength < 0) {
        return throwError(
          () => new InvalidRequestError('x-amz-decoded-content-length is required for chunked upload'),
        );
      }
      if (decodedLength > maxBytes) {
        return throwError(() => new EntityTooLargeError(decodedLength, maxBytes));
      }
    }
    // The STREAMING sentinels are not a body hash, so don't compare sha256 to them.
    const verifySha = !isStreaming && expectedSha256 !== UNSIGNED;

    // S3 flexible checksum (x-amz-checksum-*): verify the declared digest against
    // the received body and reject a mismatch with BadDigest (was previously
    // ignored for regular PUTs — silent ingest corruption).
    const checksum = declaredChecksum(req.headers as Record<string, string | string[] | undefined>);

    // The shared md5/sha256/size-cap verifier (extracted so PostObject reuses the
    // identical write path — STORY-0802). HIGH_WATER_MARK stays local so
    // TEST-0316 can pin the 256 KB literal in this file.
    const { verifier, hashes, size, rejectPending } = createBodyVerifier({
      maxBytes,
      highWaterMark: HIGH_WATER_MARK,
      expectedMd5Base64,
      expectedSha256Hex: verifySha ? expectedSha256 : undefined,
      checksum,
    });

    // For chunked uploads, the ChunkedDecoder sits between req and the verifier:
    // req → decoder (strip framing + verify chunk chain) → verifier (md5/sha256).
    const decoder = isStreaming
      ? new ChunkedDecoder({
          expectedDecodedLength: decodedLength,
          signed: isStreamingSigned,
          ctx: chunkCtx,
          trailer: isStreamingUnsignedTrailer,
        })
      : undefined;
    const head: NodeJS.WritableStream = decoder ?? verifier;

    const fail = (err: unknown): void => {
      decoder?.destroy(err as Error);
      verifier.destroy(err as Error);
      rejectPending(err);
    };

    // Per-request stall watchdog (TASK-2111, CWE-400). Bound the body phase via
    // the SOCKET inactivity timeout rather than a per-chunk data listener: adding
    // a "data" event listener would force the request into flowing mode and
    // defeat the pull-based backpressure this interceptor relies on (TEST-0316).
    // The socket timeout auto-resets on I/O, so an actively-progressing multi-GB
    // PUT is never interrupted, while a body that sends no bytes for
    // STALL_TIMEOUT_MS trips the callback and is destroyed (the server-wide
    // requestTimeout in main.ts is the coarse backstop). Destroying the request
    // routes through `fail` via the error handler below. Cast to an optional
    // `setTimeout` so a socketless test double (a bare Readable) doesn't blow up.
    const timed = req as unknown as {
      setTimeout?: (ms: number, cb: () => void) => unknown;
    };
    timed.setTimeout?.(PutObjectInterceptor.STALL_TIMEOUT_MS, () => {
      req.destroy(new IncompleteBodyError('upload stalled: no bytes received within the idle window'));
    });

    // Surface request-side failures into the pipeline and the pending promises.
    req.on('error', fail);
    // Node sometimes emits 'aborted' but not 'error' on client close.
    req.on('aborted', () => fail(new IncompleteBodyError('Client aborted the request')));
    decoder?.on('error', fail);
    verifier.on('error', (err) => rejectPending(err));

    // pipe() handles backpressure: the 256 KB hwm pauses req when BlobStore lags.
    req.pipe(head);
    if (decoder) decoder.pipe(verifier);

    req.openbucketPutCtx = { stream: verifier, hashes, size };
    return next.handle();
  }
}
