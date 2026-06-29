import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';

import { BadDigestError, IncompleteBodyError, SignatureDoesNotMatchError } from '../errors/s3-error';
import { ChunkSigningContext, expectedChunkSignature } from '../sigv4/chunk-signing';
import { Sigv4Verifier } from '../sigv4/sigv4.verifier';
import { ChunkedDecoder, ChunkedDecoderOptions } from './chunked-decoder';

const sha256Hex = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** Build a valid SIGNED `aws-chunked` body for `chunks`, appending the zero-length final chunk. */
function buildSignedBody(ctx: ChunkSigningContext, chunks: Buffer[]): Buffer {
  let prev = ctx.seedSignature;
  const parts: Buffer[] = [];
  for (const data of [...chunks, Buffer.alloc(0)]) {
    const sig = expectedChunkSignature({
      signingKey: ctx.signingKey,
      amzDate: ctx.amzDate,
      credentialScope: ctx.credentialScope,
      previousSignature: prev,
      chunkSha256Hex: sha256Hex(data),
    });
    parts.push(Buffer.from(`${data.length.toString(16)};chunk-signature=${sig}\r\n`, 'latin1'));
    parts.push(data);
    parts.push(Buffer.from('\r\n', 'latin1'));
    prev = sig;
  }
  return Buffer.concat(parts);
}

/** Build an UNSIGNED `aws-chunked` body with an optional CRC-32 trailer. */
function buildUnsignedTrailerBody(chunks: Buffer[], crcTrailer = true): Buffer {
  const parts: Buffer[] = [];
  for (const data of chunks) {
    parts.push(Buffer.from(`${data.length.toString(16)}\r\n`, 'latin1'));
    parts.push(data);
    parts.push(Buffer.from('\r\n', 'latin1'));
  }
  parts.push(Buffer.from('0\r\n', 'latin1')); // final zero-length chunk
  if (crcTrailer) {
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat(chunks)) >>> 0);
    parts.push(Buffer.from(`x-amz-checksum-crc32:${crc.toString('base64')}\r\n`, 'latin1'));
  }
  parts.push(Buffer.from('\r\n', 'latin1')); // blank line ends the trailer section
  return Buffer.concat(parts);
}

/** Pipe `input` through a decoder (optionally in `splitSize` slices) and collect the decoded output. */
function runDecoder(opts: ChunkedDecoderOptions, input: Buffer, splitSize?: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const d = new ChunkedDecoder(opts);
    const out: Buffer[] = [];
    d.on('data', (c: Buffer) => out.push(c));
    d.on('end', () => resolve(Buffer.concat(out)));
    d.on('error', reject);
    if (splitSize) {
      for (let i = 0; i < input.length; i += splitSize) d.write(input.subarray(i, i + splitSize));
    } else {
      d.write(input);
    }
    d.end();
  });
}

const ctx: ChunkSigningContext = {
  // Self-consistent context for the signed round-trip tests (build + verify share it).
  signingKey: crypto.createHash('sha256').update('test-signing-key').digest(),
  seedSignature: 'a'.repeat(64),
  amzDate: '20260624T000000Z',
  credentialScope: '20260624/us-east-1/s3/aws4_request',
};
const signed = (decodedLen: number): ChunkedDecoderOptions => ({
  expectedDecodedLength: decodedLen,
  signed: true,
  ctx,
  trailer: false,
});
const unsignedTrailer = (decodedLen: number): ChunkedDecoderOptions => ({
  expectedDecodedLength: decodedLen,
  signed: false,
  trailer: true,
});

describe('chunk-signing — AWS reference vectors', () => {
  // From AWS docs: "Signature Calculations … Transferring Payload in Multiple
  // Chunks (Chunked Upload)". Validates the string-to-sign format independently.
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  const scope = '20130524/us-east-1/s3/aws4_request';
  const amzDate = '20130524T000000Z';
  const signingKey = new Sigv4Verifier().deriveSigningKey(secret, scope);
  const seed = '4f232c4386841ef735655705268965c44a0e4690baa4adea153f7db9fa80a0a9';

  it('chunk 1 (65536 × "a") matches the published signature', () => {
    expect(
      expectedChunkSignature({
        signingKey,
        amzDate,
        credentialScope: scope,
        previousSignature: seed,
        chunkSha256Hex: sha256Hex(Buffer.alloc(65536, 'a')),
      }),
    ).toBe('ad80c730a21e5b8d04586a2213dd63b9a0e99e0e2307b0ade35a65485a288648');
  });

  it('chunk 2 (1024 × "a") chains from chunk 1', () => {
    expect(
      expectedChunkSignature({
        signingKey,
        amzDate,
        credentialScope: scope,
        previousSignature: 'ad80c730a21e5b8d04586a2213dd63b9a0e99e0e2307b0ade35a65485a288648',
        chunkSha256Hex: sha256Hex(Buffer.alloc(1024, 'a')),
      }),
    ).toBe('0055627c9e194cb4542bae2aa5492e3c1575bbb81b612b7d234b86a503ef5497');
  });

  it('final zero-length chunk chains from chunk 2', () => {
    expect(
      expectedChunkSignature({
        signingKey,
        amzDate,
        credentialScope: scope,
        previousSignature: '0055627c9e194cb4542bae2aa5492e3c1575bbb81b612b7d234b86a503ef5497',
        chunkSha256Hex: sha256Hex(Buffer.alloc(0)),
      }),
    ).toBe('b6c6ea8a5354eaf15b3cb7646744f4275b71ea724fed81ceb9323e279d449df9');
  });
});

describe('ChunkedDecoder — signed (STORY-0119)', () => {
  it('round-trips a single chunk', async () => {
    const body = crypto.randomBytes(4096);
    expect((await runDecoder(signed(body.length), buildSignedBody(ctx, [body]))).equals(body)).toBe(true);
  });

  it('round-trips multiple chunks reassembled in order', async () => {
    const a = crypto.randomBytes(65536);
    const b = crypto.randomBytes(1024);
    const decoded = await runDecoder(signed(a.length + b.length), buildSignedBody(ctx, [a, b]));
    expect(decoded.equals(Buffer.concat([a, b]))).toBe(true);
  });

  it('reassembles correctly across arbitrary read boundaries (1-byte writes)', async () => {
    const body = crypto.randomBytes(3000);
    expect((await runDecoder(signed(body.length), buildSignedBody(ctx, [body]), 1)).equals(body)).toBe(true);
  });

  it('rejects a tampered chunk signature with SignatureDoesNotMatch', async () => {
    const body = crypto.randomBytes(2048);
    const encoded = buildSignedBody(ctx, [body]);
    const i = encoded.indexOf('chunk-signature=') + 'chunk-signature='.length;
    encoded[i] = encoded[i] === 0x61 ? 0x62 : 0x61;
    await expect(runDecoder(signed(body.length), encoded)).rejects.toBeInstanceOf(SignatureDoesNotMatchError);
  });

  it('rejects a body truncated before the final chunk with IncompleteBody', async () => {
    const body = crypto.randomBytes(2048);
    const full = buildSignedBody(ctx, [body]);
    const truncated = full.subarray(0, full.indexOf('\r\n') + 2 + body.length + 2);
    await expect(runDecoder(signed(body.length), truncated)).rejects.toBeInstanceOf(IncompleteBodyError);
  });

  it('rejects when decoded length disagrees with x-amz-decoded-content-length', async () => {
    const body = crypto.randomBytes(2048);
    await expect(runDecoder(signed(body.length + 1), buildSignedBody(ctx, [body]))).rejects.toBeInstanceOf(
      IncompleteBodyError,
    );
  });
});

describe('ChunkedDecoder — unsigned + trailer (STORY-0120)', () => {
  it('round-trips a single chunk with a CRC-32 trailer', async () => {
    const body = crypto.randomBytes(4096);
    const decoded = await runDecoder(unsignedTrailer(body.length), buildUnsignedTrailerBody([body]));
    expect(decoded.equals(body)).toBe(true);
  });

  it('round-trips multiple chunks', async () => {
    const a = crypto.randomBytes(20000);
    const b = crypto.randomBytes(5000);
    const decoded = await runDecoder(unsignedTrailer(a.length + b.length), buildUnsignedTrailerBody([a, b]));
    expect(decoded.equals(Buffer.concat([a, b]))).toBe(true);
  });

  it('round-trips with no trailer checksum present', async () => {
    const body = crypto.randomBytes(1500);
    const decoded = await runDecoder(unsignedTrailer(body.length), buildUnsignedTrailerBody([body], false));
    expect(decoded.equals(body)).toBe(true);
  });

  it('reassembles across 1-byte writes', async () => {
    const body = crypto.randomBytes(2500);
    const decoded = await runDecoder(unsignedTrailer(body.length), buildUnsignedTrailerBody([body]), 1);
    expect(decoded.equals(body)).toBe(true);
  });

  it('rejects a wrong CRC-32 trailer with BadDigest', async () => {
    const body = crypto.randomBytes(2048);
    const encoded = buildUnsignedTrailerBody([body]);
    // Corrupt the base64 CRC value (last char before its CRLF).
    const at = encoded.indexOf('x-amz-checksum-crc32:') + 'x-amz-checksum-crc32:'.length;
    encoded[at] = encoded[at] === 0x41 /* 'A' */ ? 0x42 /* 'B' */ : 0x41;
    await expect(runDecoder(unsignedTrailer(body.length), encoded)).rejects.toBeInstanceOf(BadDigestError);
  });
});
