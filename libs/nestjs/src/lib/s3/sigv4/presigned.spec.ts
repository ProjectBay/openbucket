import type { Request } from 'express';
import * as aws4 from 'aws4';

import {
  InvalidArgumentError,
  RequestTimeTooSkewedError,
} from '../errors/s3-error';
import type { AccessKey, KeyService } from './key.service';
import { verifyPresigned } from './presigned';
import { Sigv4Verifier } from './sigv4.verifier';

/**
 * TEST-0107 — presigned URL verification, cross-checked against aws4's query
 * signing (`signQuery`).
 */
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const ROOT: AccessKey = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET, disabled: false };
const keyService = (key: AccessKey | null): KeyService => ({
  getSecret: jest.fn().mockResolvedValue(key),
});
const verifier = new Sigv4Verifier();

/** Build a fake express req from an aws4-presigned path (host=h). */
function presigned(method: string, pathWithQuery: string): Request {
  const opts: aws4.Request = {
    host: 'h',
    method,
    path: pathWithQuery,
    service: 's3',
    region: 'us-east-1',
    signQuery: true,
    headers: {},
  };
  aws4.sign(opts, { accessKeyId: ROOT.accessKeyId, secretAccessKey: SECRET });
  const url = new URL(`http://h${opts.path}`);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = String(v);
  return {
    method,
    originalUrl: opts.path,
    query,
    headers,
    openbucket: { requestId: 'r', kind: 's3', receivedAt: 0 },
  } as unknown as Request;
}

describe('verifyPresigned (TEST-0107)', () => {
  it('verifies a valid aws4-presigned GET and stamps the accessKeyId', async () => {
    const req = presigned('GET', '/my-bucket/my-key?X-Amz-Expires=3600');
    expect(await verifyPresigned(req, keyService(ROOT), verifier)).toBe(true);
    expect(req.openbucket.accessKeyId).toBe('AKIDEXAMPLE');
  });

  it('rejects a non-AWS4-HMAC-SHA256 algorithm with InvalidArgument', async () => {
    const req = presigned('GET', '/b/k?X-Amz-Expires=900');
    (req.query as Record<string, string>)['X-Amz-Algorithm'] = 'AWS3-HMAC';
    await expect(verifyPresigned(req, keyService(ROOT), verifier)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects X-Amz-Expires out of [1, 7 days] with InvalidArgument', async () => {
    const req = presigned('GET', '/b/k?X-Amz-Expires=900');
    (req.query as Record<string, string>)['X-Amz-Expires'] = String(8 * 24 * 60 * 60);
    await expect(verifyPresigned(req, keyService(ROOT), verifier)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects an expired URL with AccessDenied("Request has expired")', async () => {
    const req = presigned('GET', '/b/k?X-Amz-Expires=900');
    (req.query as Record<string, string>)['X-Amz-Date'] = '20200101T000000Z'; // long past
    await expect(verifyPresigned(req, keyService(ROOT), verifier)).rejects.toThrow(
      /Request has expired/,
    );
  });

  it('rejects a far-future X-Amz-Date with RequestTimeTooSkewed', async () => {
    const req = presigned('GET', '/b/k?X-Amz-Expires=900');
    (req.query as Record<string, string>)['X-Amz-Date'] = '20990101T000000Z';
    await expect(verifyPresigned(req, keyService(ROOT), verifier)).rejects.toBeInstanceOf(
      RequestTimeTooSkewedError,
    );
  });

  it('returns false on a tampered signature', async () => {
    const req = presigned('GET', '/b/k?X-Amz-Expires=900');
    (req.query as Record<string, string>)['X-Amz-Signature'] = 'd'.repeat(64);
    req.originalUrl = req.originalUrl.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${'d'.repeat(64)}`);
    expect(await verifyPresigned(req, keyService(ROOT), verifier)).toBe(false);
  });

  it('returns false for an unknown access key (no key-existence leak)', async () => {
    const req = presigned('GET', '/b/k?X-Amz-Expires=900');
    expect(await verifyPresigned(req, keyService(null), verifier)).toBe(false);
  });
});
