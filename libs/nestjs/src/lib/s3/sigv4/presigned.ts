import * as crypto from 'node:crypto';
import type { Request } from 'express';

import {
  AccessDeniedError,
  InvalidArgumentError,
  RequestTimeTooSkewedError,
} from '../errors/s3-error';
import { awsUriEncode, buildCanonicalRequest } from './canonical-request';
import { KeyService } from './key.service';
import { Sigv4Verifier } from './sigv4.verifier';

export const MAX_EXPIRES = 7 * 24 * 60 * 60; // AWS: max 7 days.
const MAX_SKEW_MS = 15 * 60 * 1000;

/**
 * Verify a presigned-URL request (WHITEPAPER §2.5). Differs from header-based
 * SigV4 in three ways: the signature is the `X-Amz-Signature` query param
 * (no Authorization header); expiry is explicit via `X-Amz-Expires`
 * (`now ∈ [X-Amz-Date, X-Amz-Date + expires]`, skew window on the start only);
 * and `X-Amz-Signature` is excluded from the canonical query while every other
 * `X-Amz-*` param is included. Returns false on a signature/unknown-key mismatch
 * so the caller can throw a generic SignatureDoesNotMatch without leaking whether
 * the access-key id is known.
 */
export async function verifyPresigned(
  req: Request,
  keys: KeyService,
  verifier: Sigv4Verifier,
): Promise<boolean> {
  const q = req.query as Record<string, string | undefined>;

  const algorithm = q['X-Amz-Algorithm'];
  if (algorithm !== 'AWS4-HMAC-SHA256') {
    throw new InvalidArgumentError('unsupported algorithm', 'X-Amz-Algorithm', algorithm ?? '');
  }

  const credential = q['X-Amz-Credential'];
  const amzDate = q['X-Amz-Date'];
  const expiresStr = q['X-Amz-Expires'];
  const signedHeadersStr = q['X-Amz-SignedHeaders'];
  const presentedSig = q['X-Amz-Signature'];

  if (!credential || !amzDate || !expiresStr || !signedHeadersStr || !presentedSig) {
    throw new AccessDeniedError('missing presigned URL parameter');
  }

  const expires = Number.parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || expires < 1 || expires > MAX_EXPIRES) {
    throw new InvalidArgumentError('X-Amz-Expires out of range', 'X-Amz-Expires', expiresStr);
  }

  const start = parseAmzDate(amzDate);
  const now = Date.now();
  if (start - MAX_SKEW_MS > now) {
    throw new RequestTimeTooSkewedError(start);
  }
  if (now > start + expires * 1000) {
    // AWS reports this as AccessDenied with Message="Request has expired".
    throw new AccessDeniedError('Request has expired');
  }

  const [accessKeyId, date, region, service, terminator] = credential.split('/');
  if (service !== 's3' || terminator !== 'aws4_request') {
    throw new AccessDeniedError('unexpected credential scope');
  }
  const credentialScope = `${date}/${region}/${service}/${terminator}`;

  const key = await keys.getSecret(accessKeyId);
  if (!key) return false; // generic mismatch — don't leak key existence

  // Strip only X-Amz-Signature from the canonical query.
  const queryWithoutSig = stripParam(req.originalUrl, 'X-Amz-Signature');
  const signedHeaders = signedHeadersStr.split(';').map((s) => s.toLowerCase());

  const canonical = buildCanonicalRequest({
    method: req.method,
    pathname: new URL(`http://h${req.originalUrl}`).pathname,
    query: queryWithoutSig,
    headers: req.headers as Record<string, string | string[] | undefined>,
    signedHeaders,
    payloadHash: 'UNSIGNED-PAYLOAD',
  });

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');

  const kDate = crypto.createHmac('sha256', `AWS4${key.secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  if (!verifier.constantTimeEquals(expected, presentedSig)) return false;

  req.openbucket.accessKeyId = accessKeyId;
  return true;
}

export interface PresignInput {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  host: string;
  scheme: string;
  method: string;
  bucket: string;
  key: string;
  expiresIn: number;
  now: Date;
  /**
   * Route prefix the store is mounted under (e.g. `/storage` in library mode).
   * Signed INTO the canonical request — `verifyPresigned` canonicalises over the
   * full `req.originalUrl` path, which includes this prefix — so a URL minted
   * with the right `basePath` verifies when the store is embedded under a mount.
   * Defaults to `''` (the standalone app mounts at the root).
   */
  basePath?: string;
}

/**
 * Mint a SigV4 query-signed (presigned) path-style GET URL, symmetric with
 * {@link verifyPresigned} (STORY-0612). Both run the same `buildCanonicalRequest`
 * over the same encoded pathname + query so a generated URL passes verification.
 */
export function buildPresignedUrl(p: PresignInput): string {
  const amzDate = p.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const credentialScope = `${date}/${p.region}/s3/aws4_request`;

  const encodedKey = p.key
    .split('/')
    .map((s) => awsUriEncode(s, false))
    .join('/');
  // Normalise the mount prefix: leading slash, no trailing slash, `''` for root.
  const prefix = p.basePath
    ? `/${p.basePath.replace(/^\/+/, '').replace(/\/+$/, '')}`.replace(/^\/$/, '')
    : '';
  const pathname = `${prefix}/${awsUriEncode(p.bucket, false)}/${encodedKey}`;

  const params = new URLSearchParams();
  params.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  params.set('X-Amz-Credential', `${p.accessKeyId}/${credentialScope}`);
  params.set('X-Amz-Date', amzDate);
  params.set('X-Amz-Expires', String(p.expiresIn));
  params.set('X-Amz-SignedHeaders', 'host');

  const canonical = buildCanonicalRequest({
    method: p.method,
    pathname,
    query: params.toString(),
    headers: { host: p.host },
    signedHeaders: ['host'],
    payloadHash: 'UNSIGNED-PAYLOAD',
  });

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');

  const kDate = crypto.createHmac('sha256', `AWS4${p.secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(p.region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  params.set('X-Amz-Signature', signature);
  return `${p.scheme}://${p.host}${pathname}?${params.toString()}`;
}

function parseAmzDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new AccessDeniedError('malformed X-Amz-Date');
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

function stripParam(url: string, name: string): string {
  const u = new URL(`http://h${url}`);
  u.searchParams.delete(name);
  return u.search.startsWith('?') ? u.search.slice(1) : u.search;
}
