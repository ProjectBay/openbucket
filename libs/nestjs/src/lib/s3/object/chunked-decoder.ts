import * as crypto from 'node:crypto';
import { Transform, TransformCallback } from 'node:stream';
import * as zlib from 'node:zlib';

import {
  BadDigestError,
  IncompleteBodyError,
  InvalidArgumentError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { ChunkSigningContext, expectedChunkSignature } from '../sigv4/chunk-signing';

const CRLF = Buffer.from('\r\n');
// `<hex-size>;chunk-signature=<64 hex>` — generous cap so a malformed/oversized
// header (or trailer line) can't make us buffer unbounded bytes scanning for CRLF.
const MAX_LINE = 1024;
const HIGH_WATER_MARK = 256 * 1024;
const SIGNED_HEADER_RE = /^([0-9a-fA-F]+);chunk-signature=([0-9a-f]{64})$/;
const UNSIGNED_HEADER_RE = /^([0-9a-fA-F]+)(?:;.*)?$/; // bare size; ignore chunk extensions

export interface ChunkedDecoderOptions {
  /** Object size from `x-amz-decoded-content-length`; decoded bytes must match. */
  expectedDecodedLength: number;
  /**
   * `true` — chunks carry `;chunk-signature=` and are verified against the
   * rolling chain (STREAMING-AWS4-HMAC-SHA256-PAYLOAD, STORY-0119). `false` —
   * unsigned chunks with no per-chunk signature (STREAMING-UNSIGNED-PAYLOAD-
   * TRAILER, STORY-0120).
   */
  signed: boolean;
  /** Required when `signed`. */
  ctx?: ChunkSigningContext;
  /** `true` — a trailer section (`name:value` lines) follows the final chunk. */
  trailer: boolean;
}

/**
 * Decodes an AWS `aws-chunked` request body. Two shapes (STORY-0119 / 0120):
 *
 * - **signed** (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`):
 *   `<hex>;chunk-signature=<sig>\r\n<data>\r\n` … `0;chunk-signature=<sig>\r\n\r\n`.
 *   Each chunk's signature is verified against the rolling chain.
 * - **unsigned + trailer** (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`, the aws-cli v2
 *   default): `<hex>\r\n<data>\r\n` … `0\r\n<trailing-header>:<value>\r\n\r\n`.
 *   No per-chunk signature; the optional trailing CRC32 checksum is validated.
 *
 * Parses across arbitrary read boundaries, strips the framing, and emits decoded
 * bytes. A bad chunk signature → `SignatureDoesNotMatch`; a trailing-checksum
 * mismatch → `BadDigest`; a body that ends before the final chunk, or whose
 * decoded length ≠ `x-amz-decoded-content-length` → `IncompleteBody`.
 *
 * Emitting decoded bytes before the final chunk/trailer is verified is safe: a
 * mid-stream failure errors this stream, aborting the two-phase staged write, so
 * unverified bytes are never committed or readable.
 */
export class ChunkedDecoder extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private state: 'header' | 'data' | 'cr' | 'trailer' | 'done' = 'header';
  private remaining = 0;
  private isFinalChunk = false;
  private chunkHash: crypto.Hash = crypto.createHash('sha256');
  private declaredSig = '';
  private prevSig: string;
  private decoded = 0;
  private crc = 0; // running zlib CRC-32 over decoded bytes (trailer mode)
  private sawEnd = false;

  constructor(private readonly opts: ChunkedDecoderOptions) {
    super({ highWaterMark: HIGH_WATER_MARK });
    this.prevSig = opts.ctx?.seedSignature ?? '';
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    try {
      this.drain();
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  override _flush(cb: TransformCallback): void {
    if (!this.sawEnd) {
      return cb(new IncompleteBodyError('chunked body ended before the final chunk'));
    }
    if (this.decoded !== this.opts.expectedDecodedLength) {
      return cb(
        new IncompleteBodyError(
          `decoded ${this.decoded} bytes but x-amz-decoded-content-length is ${this.opts.expectedDecodedLength}`,
        ),
      );
    }
    cb();
  }

  /** Parse as far as the buffered bytes allow; return when more input is needed. */
  private drain(): void {
    for (;;) {
      if (this.state === 'header') {
        const line = this.takeLine();
        if (line === null) return;
        const m = (this.opts.signed ? SIGNED_HEADER_RE : UNSIGNED_HEADER_RE).exec(line);
        if (!m) throw new InvalidArgumentError('malformed chunk header', 'body', line.slice(0, 64));
        this.remaining = parseInt(m[1], 16);
        this.isFinalChunk = this.remaining === 0;
        if (this.opts.signed) {
          this.declaredSig = m[2];
          this.chunkHash = crypto.createHash('sha256');
        }
        if (this.remaining === 0) {
          if (this.opts.signed) this.verifyChunk();
          this.state = this.opts.trailer ? 'trailer' : 'cr';
        } else {
          this.state = 'data';
        }
      } else if (this.state === 'data') {
        if (this.pending.length === 0) return;
        const take = Math.min(this.remaining, this.pending.length);
        const data = this.pending.subarray(0, take);
        this.pending = this.pending.subarray(take);
        this.decoded += take;
        if (this.decoded > this.opts.expectedDecodedLength) {
          throw new IncompleteBodyError('decoded length exceeds x-amz-decoded-content-length');
        }
        if (this.opts.signed) this.chunkHash.update(data);
        if (this.opts.trailer) this.crc = zlib.crc32(data, this.crc);
        this.push(data);
        this.remaining -= take;
        if (this.remaining === 0) {
          if (this.opts.signed) this.verifyChunk();
          this.state = 'cr';
        } else {
          return;
        }
      } else if (this.state === 'cr') {
        if (this.pending.length < CRLF.length) return;
        if (this.pending[0] !== 0x0d || this.pending[1] !== 0x0a) {
          throw new InvalidArgumentError('expected CRLF after chunk data', 'body', '');
        }
        this.pending = this.pending.subarray(CRLF.length);
        if (this.isFinalChunk) {
          this.sawEnd = true;
          this.state = 'done';
        } else {
          this.state = 'header';
        }
      } else if (this.state === 'trailer') {
        const line = this.takeLine();
        if (line === null) return;
        if (line === '') {
          // Blank line terminates the trailer section.
          this.sawEnd = true;
          this.state = 'done';
        } else {
          this.checkTrailer(line);
        }
      } else {
        // 'done' — ignore any trailing bytes.
        return;
      }
    }
  }

  /** Consume up to (and discard) the next CRLF; return the line, or null if incomplete. */
  private takeLine(): string | null {
    const idx = this.pending.indexOf(CRLF);
    if (idx === -1) {
      if (this.pending.length > MAX_LINE) {
        throw new InvalidArgumentError('chunked framing line exceeds maximum length', 'body', '');
      }
      return null;
    }
    const line = this.pending.subarray(0, idx).toString('latin1');
    this.pending = this.pending.subarray(idx + CRLF.length);
    return line;
  }

  private verifyChunk(): void {
    const chunkSha256Hex = this.chunkHash.digest('hex');
    const expected = expectedChunkSignature({
      signingKey: this.opts.ctx!.signingKey,
      amzDate: this.opts.ctx!.amzDate,
      credentialScope: this.opts.ctx!.credentialScope,
      previousSignature: this.prevSig,
      chunkSha256Hex,
    });
    if (!timingSafeHexEqual(expected, this.declaredSig)) {
      throw new SignatureDoesNotMatchError();
    }
    this.prevSig = this.declaredSig;
  }

  /**
   * Validate a trailing header line. The aws-cli v2 default is a CRC-32
   * (`x-amz-checksum-crc32: <base64 of 4-byte BE>`), which we verify. Other
   * algorithms (crc32c/sha1/sha256) are accepted without validation for now —
   * the unsigned-payload security posture is unchanged either way.
   */
  private checkTrailer(line: string): void {
    const colon = line.indexOf(':');
    if (colon === -1) return; // tolerate non-checksum trailer lines
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'x-amz-checksum-crc32') {
      const expected = Buffer.alloc(4);
      expected.writeUInt32BE(this.crc >>> 0);
      if (expected.toString('base64') !== value) {
        throw new BadDigestError();
      }
    }
  }
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
