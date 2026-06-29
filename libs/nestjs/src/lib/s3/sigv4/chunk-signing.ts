import * as crypto from 'node:crypto';

/**
 * SigV4 chunked-upload signing context (STORY-0119). Resolved by `SigV4Guard`
 * after it verifies the seed signature, and consumed by the `ChunkedDecoder`
 * to verify the rolling per-chunk signature chain.
 */
export interface ChunkSigningContext {
  /** Derived AWS4 signing key (`kSigning`) for this request. */
  signingKey: Buffer;
  /** Seed signature — the (already-verified) `Signature=` from the Authorization header. */
  seedSignature: string;
  /** `x-amz-date`, ISO basic (`YYYYMMDDTHHMMSSZ`). */
  amzDate: string;
  /** Credential scope: `date/region/service/aws4_request`. */
  credentialScope: string;
}

const EMPTY_SHA256_HEX = crypto.createHash('sha256').update('').digest('hex');

/**
 * The expected per-chunk signature for an AWS `aws-chunked` body
 * (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD`). Each chunk's string-to-sign chains
 * from the previous signature (the seed signature for the first chunk):
 *
 * ```
 * AWS4-HMAC-SHA256-PAYLOAD\n
 * <amzDate>\n
 * <credentialScope>\n
 * <previousSignature>\n
 * <SHA256("") hex>\n
 * <SHA256(chunkData) hex>
 * ```
 *
 * `chunkSignature = hex(HMAC-SHA256(signingKey, stringToSign))`. The final
 * zero-length chunk signs `SHA256("")`.
 */
export function expectedChunkSignature(args: {
  signingKey: Buffer;
  amzDate: string;
  credentialScope: string;
  previousSignature: string;
  /** Hex SHA-256 of the chunk's payload bytes (empty-string hash for the final chunk). */
  chunkSha256Hex: string;
}): string {
  const stringToSign = [
    'AWS4-HMAC-SHA256-PAYLOAD',
    args.amzDate,
    args.credentialScope,
    args.previousSignature,
    EMPTY_SHA256_HEX,
    args.chunkSha256Hex,
  ].join('\n');
  return crypto.createHmac('sha256', args.signingKey).update(stringToSign, 'utf8').digest('hex');
}
