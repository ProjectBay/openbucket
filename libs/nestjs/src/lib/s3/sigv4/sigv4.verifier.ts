import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { Request } from 'express';

import { buildCanonicalRequest } from './canonical-request';

/**
 * Sigv4Verifier — canonical request reconstruction + signing key derivation
 * (WHITEPAPER §2.4.4). Reverse-verifies the client's signature: rebuild the
 * canonical request, derive `kSigning` from the secret, and produce the hex
 * signature the client *should* have sent.
 */
@Injectable()
export class Sigv4Verifier {
  async signatureForHeaderRequest(args: {
    req: Request;
    secretAccessKey: string;
    credentialScope: string; // 20260520/us-east-1/s3/aws4_request
    signedHeaders: string[];
    amzDate: string;
  }): Promise<string> {
    const { req, secretAccessKey, credentialScope, signedHeaders, amzDate } = args;

    // 1. Payload hash: SDKs send either the body's sha256 in lowercase hex,
    //    or the literal string 'UNSIGNED-PAYLOAD'. The header is part of
    //    the SignedHeaders list, so its value participates in the canonical
    //    request verbatim — we do NOT recompute over the body.
    const payloadHash =
      (req.headers['x-amz-content-sha256'] as string | undefined) ?? 'UNSIGNED-PAYLOAD';

    // 2. Canonical request.
    const canonical = buildCanonicalRequest({
      method: req.method,
      pathname: this.originalPath(req),
      query: this.queryStringForCanonical(req),
      headers: req.headers as Record<string, string | string[] | undefined>,
      signedHeaders,
      payloadHash,
    });

    const hashedCanonical = sha256Hex(canonical);

    // 3. String to sign.
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hashedCanonical].join('\n');

    // 4. Derive signing key + sign.
    const kSigning = this.deriveSigningKey(secretAccessKey, credentialScope);

    return hmacHex(kSigning, stringToSign);
  }

  /**
   * Derive the AWS4 signing key (`kSigning`) from the secret and credential
   * scope (`date/region/service/aws4_request`). Exposed so chunked-upload
   * signing (STORY-0119) can verify the per-chunk signature chain with the same
   * key that produced the seed signature. Delegates to the free
   * {@link deriveSigningKey} so the pure POST-policy crypto (STORY-0802) shares
   * one implementation.
   */
  deriveSigningKey(secretAccessKey: string, credentialScope: string): Buffer {
    return deriveSigningKey(secretAccessKey, credentialScope);
  }

  constantTimeEquals(a: string, b: string): boolean {
    return constantTimeEquals(a, b);
  }

  private originalPath(req: Request): string {
    // Express has already URL-decoded once. SigV4 wants the path with each
    // segment URL-encoded per RFC 3986 (S3 uses single-encoding).
    const u = new URL(`http://h${req.originalUrl}`);
    return u.pathname;
  }

  private queryStringForCanonical(req: Request): string {
    const u = new URL(`http://h${req.originalUrl}`);
    return u.search.startsWith('?') ? u.search.slice(1) : u.search;
  }
}

function sha256Hex(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function hmacHex(key: Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

/**
 * Derive the AWS4 signing key (`kSigning`) from a secret + credential scope
 * (`date/region/service/aws4_request`). A pure free function (no Nest deps) so
 * the presigned-URL minting (`presigned.ts`) and the POST-policy crypto module
 * (`presigned-post.ts`, STORY-0802) can reuse the exact derivation the
 * `Sigv4Verifier` uses to reverse-verify header signatures.
 */
export function deriveSigningKey(secretAccessKey: string, credentialScope: string): Buffer {
  const [date, region, service] = credentialScope.split('/');
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Constant-time string comparison over UTF-8 bytes (length-mismatch short
 * circuits). Free-function twin of {@link Sigv4Verifier.constantTimeEquals} so
 * the pure POST-policy verifier can compare signatures without leaking their
 * length/content through timing.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
