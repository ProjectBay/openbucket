import { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import * as aws4 from 'aws4';

import {
  InvalidArgumentError,
  RequestTimeTooSkewedError,
  SignatureDoesNotMatchError,
} from '../errors/s3-error';
import { awsUriEncode, buildCanonicalRequest, canonicaliseQuery } from './canonical-request';
import type { AccessKey, KeyService } from './key.service';
import { SigV4Guard } from './sigv4.guard';
import { Sigv4Verifier } from './sigv4.verifier';

/**
 * TEST-0104 — SigV4 canonical request, verifier, and guard unit.
 *
 * Cross-checked against the `aws4` signing library and the AWS-published
 * SigV4 "GET Object" reference example (WHITEPAPER §2.4).
 */

const STREAMING_SHA = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Format a Date as ISO basic `YYYYMMDDTHHMMSSZ`. */
function amzBasic(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Sign with aws4 and return a fake express req mirroring what was signed. */
function signedReq(input: {
  method?: string;
  host: string;
  path: string;
}): { req: Request; parsedAuthz: string } {
  const opts: aws4.Request = {
    host: input.host,
    method: input.method ?? 'GET',
    path: input.path,
    service: 's3',
    region: 'us-east-1',
    headers: {},
  };
  aws4.sign(opts, {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers[k.toLowerCase()] = String(v);
  }
  const req = {
    method: opts.method,
    originalUrl: input.path,
    headers,
    query: {},
    openbucket: { requestId: 'rid', kind: 's3', receivedAt: 0 },
  } as unknown as Request;
  return { req, parsedAuthz: headers['authorization'] };
}

function ctxFor(req: Request): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const ROOT_CREDS: AccessKey = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  disabled: false,
  isRoot: true,
  scopePolicy: null,
};

describe('SigV4 (TEST-0104)', () => {
  const verifier = new Sigv4Verifier();

  // ---------- awsUriEncode (cases 1-3) ----------------------------------

  it('case 1: awsUriEncode preserves slashes when encodeSlash=false', () => {
    expect(awsUriEncode('a b/c?d', false)).toBe('a%20b/c%3Fd');
  });

  it('case 2: awsUriEncode encodes slashes when encodeSlash=true', () => {
    expect(awsUriEncode('a b/c', true)).toBe('a%20b%2Fc');
  });

  it('case 3: awsUriEncode percent-encodes UTF-8 byte-by-byte', () => {
    // 'é' = U+00E9 = UTF-8 0xC3 0xA9.
    expect(awsUriEncode('é', true)).toBe('%C3%A9');
  });

  // ---------- canonicaliseQuery (case 4) --------------------------------

  it('case 4: canonicaliseQuery sorts by key then value', () => {
    expect(canonicaliseQuery('b=2&a=1&a=3')).toBe('a=1&a=3&b=2');
  });

  // ---------- buildCanonicalRequest (case 5) ----------------------------

  it('case 5: buildCanonicalRequest matches the AWS docs GET-Object reference', () => {
    const canonical = buildCanonicalRequest({
      method: 'GET',
      pathname: '/test.txt',
      query: '',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_SHA256,
        'x-amz-date': '20130524T000000Z',
      },
      signedHeaders: ['host', 'range', 'x-amz-content-sha256', 'x-amz-date'],
      payloadHash: EMPTY_SHA256,
    });

    expect(canonical).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_SHA256,
      ].join('\n'),
    );
  });

  // ---------- signatureForHeaderRequest (case 6) ------------------------

  it('case 6a: verifier reproduces the AWS docs reference signature', async () => {
    const refReq = {
      method: 'GET',
      originalUrl: '/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_SHA256,
        'x-amz-date': '20130524T000000Z',
      },
    } as unknown as Request;

    const sig = await verifier.signatureForHeaderRequest({
      req: refReq,
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      credentialScope: '20130524/us-east-1/s3/aws4_request',
      signedHeaders: ['host', 'range', 'x-amz-content-sha256', 'x-amz-date'],
      amzDate: '20130524T000000Z',
    });

    expect(sig).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('case 6b: verifier signature equals what aws4.sign produced (cross-check)', async () => {
    const { req, parsedAuthz } = signedReq({ host: 'my-bucket.localhost', path: '/key.txt' });
    const m = /Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)/.exec(
      parsedAuthz,
    );
    expect(m).not.toBeNull();
    const [, credential, signedHeadersStr, aws4Signature] = m as RegExpExecArray;
    const credParts = credential.split('/');
    const credentialScope = credParts.slice(1).join('/');

    const sig = await verifier.signatureForHeaderRequest({
      req,
      secretAccessKey: ROOT_CREDS.secretAccessKey,
      credentialScope,
      signedHeaders: signedHeadersStr.split(';'),
      amzDate: req.headers['x-amz-date'] as string,
    });

    expect(sig).toBe(aws4Signature);
  });

  // ---------- constantTimeEquals (case 7) -------------------------------

  it('case 7: constantTimeEquals compares value and length', () => {
    expect(verifier.constantTimeEquals('abc', 'abc')).toBe(true);
    expect(verifier.constantTimeEquals('abc', 'abd')).toBe(false);
    expect(verifier.constantTimeEquals('ab', 'abc')).toBe(false);
  });

  // ---------- SigV4Guard (cases 8-10 + happy paths) ---------------------

  const mkGuard = (key: AccessKey | null) => {
    const keys: KeyService = { getSecret: jest.fn().mockResolvedValue(key) };
    return new SigV4Guard(keys, verifier);
  };

  // Plain STREAMING-AWS4-HMAC-SHA256-PAYLOAD is now accepted (STORY-0119) — its
  // seed is verified like any header-signed request and the chunk chain is
  // checked downstream by ChunkedDecoder. Only the trailing-checksum variants
  // are rejected here.
  it('case 8: STREAMING-...-TRAILER (trailing checksum) → InvalidArgumentError', async () => {
    const guard = mkGuard(ROOT_CREDS);
    const trailer = `${STREAMING_SHA}-TRAILER`;
    const req = {
      headers: { 'x-amz-content-sha256': trailer },
      query: {},
      openbucket: { kind: 's3', requestId: 'r', receivedAt: 0 },
    } as unknown as Request;

    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(InvalidArgumentError);
    try {
      await guard.canActivate(ctxFor(req));
    } catch (e) {
      expect((e as InvalidArgumentError).extra.ArgumentName).toBe('x-amz-content-sha256');
      expect((e as InvalidArgumentError).extra.ArgumentValue).toBe(trailer);
    }
  });

  it('case 9: checkSkew accepts ±14 min and rejects ±16 min', () => {
    const guard = mkGuard(ROOT_CREDS) as unknown as { checkSkew(d: string): void };
    expect(() => guard.checkSkew(amzBasic(new Date(Date.now() - 14 * 60 * 1000)))).not.toThrow();
    expect(() => guard.checkSkew(amzBasic(new Date(Date.now() + 14 * 60 * 1000)))).not.toThrow();
    expect(() => guard.checkSkew(amzBasic(new Date(Date.now() - 16 * 60 * 1000)))).toThrow(
      RequestTimeTooSkewedError,
    );
  });

  it('case 10: parseAuthorization extracts the four parts', () => {
    const guard = mkGuard(ROOT_CREDS) as unknown as {
      parseAuthorization(a: string): {
        accessKeyId: string;
        credentialScope: string;
        signedHeaders: string[];
        signature: string;
      };
    };
    const parsed = guard.parseAuthorization(
      'AWS4-HMAC-SHA256 Credential=AKID/20260520/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host, Signature=deadbeef',
    );
    expect(parsed.accessKeyId).toBe('AKID');
    expect(parsed.credentialScope).toBe('20260520/us-east-1/s3/aws4_request');
    expect(parsed.signedHeaders).toEqual(['host']);
    expect(parsed.signature).toBe('deadbeef');
  });

  it('happy path: a valid aws4-signed header request authenticates and stamps accessKeyId', async () => {
    const { req } = signedReq({ host: 'my-bucket.localhost', path: '/some/key.txt' });
    const guard = mkGuard(ROOT_CREDS);
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.openbucket.accessKeyId).toBe('AKIDEXAMPLE');
  });

  it('tampered: wrong secret → SignatureDoesNotMatchError', async () => {
    const { req } = signedReq({ host: 'my-bucket.localhost', path: '/some/key.txt' });
    const guard = mkGuard({ ...ROOT_CREDS, secretAccessKey: 'the-wrong-secret' });
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(SignatureDoesNotMatchError);
  });

  it('unknown key → SignatureDoesNotMatchError', async () => {
    const { req } = signedReq({ host: 'my-bucket.localhost', path: '/some/key.txt' });
    const guard = mkGuard(null);
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(SignatureDoesNotMatchError);
  });
});
