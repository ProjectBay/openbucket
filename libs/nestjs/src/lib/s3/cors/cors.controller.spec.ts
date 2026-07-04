import type { Request, Response } from 'express';

import type { Bucket, CorsRule } from '../../persistence/index';

import { BucketService } from '../../domain/buckets/bucket.service';
import { AccessDeniedError } from '../errors/s3-error';
import { RouteResolver } from '../routing/route-resolver';
import { CorsController, globMatch, matchHeader, matchOrigin } from './cors.controller';

/**
 * TEST-0131 — CorsController.preflight rule-matching, error paths, and header
 * emission (§2.9), plus the glob/origin/header matcher semantics.
 */

function mockRes(): { res: Response; headers: Record<string, string>; status: jest.Mock; end: jest.Mock } {
  const headers: Record<string, string> = {};
  const status = jest.fn().mockReturnThis();
  const end = jest.fn().mockReturnThis();
  const res = {
    status,
    end,
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
  } as unknown as Response;
  return { res, headers, status, end };
}

function mockReq(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

function makeController(findResult: Bucket | null) {
  const buckets = { findByName: jest.fn().mockResolvedValue(findResult) } as unknown as BucketService;
  const routes = {
    resolve: jest.fn().mockReturnValue({ bucket: 'b', key: 'k' }),
  } as unknown as RouteResolver;
  return new CorsController(buckets, routes);
}

const bucketWith = (cors?: CorsRule[]): Bucket => ({ name: 'b', cors }) as unknown as Bucket;

describe('CORS glob matchers (TEST-0131 cases 1-4)', () => {
  it('globMatch("*", anything) → true', () => {
    expect(globMatch('*', 'anything')).toBe(true);
  });
  it('globMatch wildcard subdomain → true', () => {
    expect(globMatch('https://*.example.com', 'https://app.example.com')).toBe(true);
  });
  it('globMatch exact mismatch → false', () => {
    expect(globMatch('https://example.com', 'https://other.com')).toBe(false);
  });
  it('matchOrigin over a list', () => {
    expect(matchOrigin(['https://a.com', 'https://*.b.com'], 'https://x.b.com')).toBe(true);
    expect(matchOrigin(['https://a.com'], 'https://z.com')).toBe(false);
  });
  it('matchHeader is case-insensitive', () => {
    expect(matchHeader(['Content-Type'], 'content-type')).toBe(true);
  });
});

describe('CorsController.preflight (TEST-0131 cases 5-11)', () => {
  it('case 5: no Origin/method → 200 Allow, no CORS headers', async () => {
    const ctrl = makeController(bucketWith());
    const { res, headers, status, end } = mockRes();
    await ctrl.objectPreflight(mockReq({}), res);
    expect(status).toHaveBeenCalledWith(200);
    expect(headers['Allow']).toBe('GET, HEAD, PUT, POST, DELETE, OPTIONS');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(end).toHaveBeenCalled();
  });

  // TASK-2112 (CWE-203): the three non-matching cases must be indistinguishable —
  // a uniform AccessDeniedError with byte-identical Code + Message — so an
  // anonymous caller can't diff them to enumerate bucket existence.
  const NO_MATCH_MESSAGE = 'CORSResponse: This CORS request is not allowed.';

  it('case 6: bucket not found → uniform AccessDeniedError (no existence oracle)', async () => {
    const ctrl = makeController(null);
    const { res } = mockRes();
    const err = await ctrl
      .objectPreflight(
        mockReq({ origin: 'https://example.com', 'access-control-request-method': 'GET' }),
        res,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessDeniedError);
    expect((err as AccessDeniedError).message).toBe(NO_MATCH_MESSAGE);
  });

  it('case 7: bucket without CORS config → uniform AccessDeniedError (no existence oracle)', async () => {
    const ctrl = makeController(bucketWith(undefined));
    const { res } = mockRes();
    const err = await ctrl
      .objectPreflight(
        mockReq({ origin: 'https://example.com', 'access-control-request-method': 'GET' }),
        res,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessDeniedError);
    expect((err as AccessDeniedError).message).toBe(NO_MATCH_MESSAGE);
  });

  it('case 8: no matching rule → uniform AccessDeniedError', async () => {
    const ctrl = makeController(
      bucketWith([{ allowedOrigins: ['https://allowed.com'], allowedMethods: ['GET'] }]),
    );
    const { res } = mockRes();
    const err = await ctrl
      .objectPreflight(
        mockReq({ origin: 'https://evil.com', 'access-control-request-method': 'GET' }),
        res,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessDeniedError);
    expect((err as AccessDeniedError).message).toBe(NO_MATCH_MESSAGE);
  });

  it('case 8b: missing / no-CORS / no-match preflights are byte-identical (no discrepancy)', async () => {
    const req = mockReq({ origin: 'https://evil.com', 'access-control-request-method': 'GET' });
    const collect = async (bucket: Bucket | null): Promise<{ code: string; message: string }> => {
      const err = (await makeController(bucket)
        .objectPreflight(req, mockRes().res)
        .catch((e: unknown) => e)) as { code: string; message: string };
      return { code: err.code, message: err.message };
    };
    const missing = await collect(null);
    const noCors = await collect(bucketWith(undefined));
    const noMatch = await collect(
      bucketWith([{ allowedOrigins: ['https://allowed.com'], allowedMethods: ['GET'] }]),
    );
    expect(missing).toEqual(noMatch);
    expect(noCors).toEqual(noMatch);
    expect(missing.code).toBe('AccessDenied');
  });

  it('case 9: rule with allowedOrigins ["*"] → Allow-Origin: *', async () => {
    const ctrl = makeController(bucketWith([{ allowedOrigins: ['*'], allowedMethods: ['GET'] }]));
    const { res, headers } = mockRes();
    await ctrl.objectPreflight(
      mockReq({ origin: 'https://anything.com', 'access-control-request-method': 'GET' }),
      res,
    );
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('case 10: literal-origin match → Allow-Origin echoes origin + Vary', async () => {
    const ctrl = makeController(
      bucketWith([{ allowedOrigins: ['https://example.com'], allowedMethods: ['GET', 'PUT'] }]),
    );
    const { res, headers } = mockRes();
    await ctrl.objectPreflight(
      mockReq({ origin: 'https://example.com', 'access-control-request-method': 'GET' }),
      res,
    );
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, PUT');
    expect(headers['Vary']).toBe(
      'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    );
  });

  it('case 11: maxAgeSeconds + headers emitted', async () => {
    const ctrl = makeController(
      bucketWith([
        {
          allowedOrigins: ['https://example.com'],
          allowedMethods: ['GET'],
          allowedHeaders: ['*'],
          exposeHeaders: ['ETag'],
          maxAgeSeconds: 3000,
        },
      ]),
    );
    const { res, headers } = mockRes();
    await ctrl.objectPreflight(
      mockReq({
        origin: 'https://example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-custom-header',
      }),
      res,
    );
    expect(headers['Access-Control-Max-Age']).toBe('3000');
    expect(headers['Access-Control-Allow-Headers']).toBe('*');
    expect(headers['Access-Control-Expose-Headers']).toBe('ETag');
  });
});
