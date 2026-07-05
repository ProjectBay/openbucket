import type { Request } from 'express';
import * as aws4 from 'aws4';

import {
  InvalidArgumentError,
  RequestTimeTooSkewedError,
} from '../errors/s3-error';
import type { AccessKey, KeyService } from './key.service';
import { stripSigV4QueryAuth, verifyPresigned } from './presigned';
import { Sigv4Verifier } from './sigv4.verifier';

/**
 * TEST-0107 — presigned URL verification, cross-checked against aws4's query
 * signing (`signQuery`).
 */
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const ROOT: AccessKey = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: SECRET,
  disabled: false,
  isRoot: true,
  scopePolicy: null,
};
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

/**
 * TEST-0705 — stripSigV4QueryAuth: the log-sanitizer that keeps replayable
 * presigned credentials out of request logs (TASK-2150, CWE-532).
 */
describe('stripSigV4QueryAuth (TEST-0705)', () => {
  it('case 1: removes X-Amz-Signature and X-Amz-Credential', () => {
    const url =
      '/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
      '&X-Amz-Credential=AKIDEXAMPLE%2F20260704%2Fus-east-1%2Fs3%2Faws4_request' +
      '&X-Amz-Date=20260704T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host' +
      `&X-Amz-Signature=${'a'.repeat(64)}`;
    const out = stripSigV4QueryAuth(url);
    expect(out).not.toContain('a'.repeat(64));
    expect(out).not.toContain('AKIDEXAMPLE');
    expect(out).not.toContain('X-Amz-Signature');
    expect(out).not.toContain('X-Amz-Credential');
    // Benign SigV4 params (algorithm, date, expires) stay for debuggability.
    expect(out).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(out.startsWith('/bucket/key?')).toBe(true);
  });

  it('case 2: removes X-Amz-Security-Token', () => {
    const out = stripSigV4QueryAuth('/b/k?X-Amz-Security-Token=SESSIONTOKENVALUE&x=1');
    expect(out).not.toContain('SESSIONTOKENVALUE');
    expect(out).not.toContain('X-Amz-Security-Token');
    expect(out).toContain('x=1');
  });

  it('case 3: leaves a non-presigned URL with benign query params unchanged', () => {
    expect(stripSigV4QueryAuth('/b/k?prefix=foo&max-keys=10')).toBe('/b/k?prefix=foo&max-keys=10');
    expect(stripSigV4QueryAuth('/b/k')).toBe('/b/k');
  });

  it('case 4: a malformed URL does not throw and never leaks the signature', () => {
    const sig = 's'.repeat(64);
    const weird = `not a valid url with spaces?X-Amz-Signature=${sig}`;
    let out!: string;
    expect(() => {
      out = stripSigV4QueryAuth(weird);
    }).not.toThrow();
    expect(typeof out).toBe('string');
    expect(out).not.toContain(sig);
  });
});
