import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { NoSuchKeyError } from './s3-error';
import { S3ExceptionFilter } from './s3-exception.filter';

/**
 * TEST-0110 (unit-level coverage) — S3ExceptionFilter body, WHITEPAPER §2.7.
 *
 * The e2e plan (TEST-0110) boots the app and throws over HTTP; the filter's
 * logic is fully exercisable against a mocked ArgumentsHost, mirroring the M0
 * common/filters/s3-exception.filter.spec.ts pattern. The e2e plan remains
 * deferred (backlog), consistent with the sibling TEST-0103.
 */
interface ResCapture {
  statusCode?: number;
  headers: Record<string, string | number>;
  body?: string;
  ended: boolean;
  destroyedWith?: unknown;
  headersSent: boolean;
}

interface ReqOverrides {
  method?: string;
  originalUrl?: string;
  openbucket?: Record<string, unknown>;
}

function makeHost(
  reqOverrides: ReqOverrides,
  resOverrides: Partial<ResCapture> = {},
): { host: ArgumentsHost; res: ResCapture } {
  const res: ResCapture = { headers: {}, ended: false, headersSent: false, ...resOverrides };
  const response = {
    get headersSent() {
      return res.headersSent;
    },
    status: (s: number) => {
      res.statusCode = s;
      return response;
    },
    setHeader: (k: string, v: string | number) => {
      res.headers[k.toLowerCase()] = v;
    },
    end: (b?: string) => {
      res.ended = true;
      if (b !== undefined) res.body = b;
    },
    destroy: (e: unknown) => {
      res.destroyedWith = e;
    },
  } as unknown as Response;

  const request = { method: 'GET', originalUrl: '/', ...reqOverrides } as unknown as Request;

  const host = {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
    }),
  } as ArgumentsHost;

  return { host, res };
}

describe('S3ExceptionFilter (TEST-0110 unit)', () => {
  let filter: S3ExceptionFilter;
  let errSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new S3ExceptionFilter();
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('case 1: NoSuchKeyError → 404 canonical AWS XML envelope (§2.7 sample)', () => {
    const { host, res } = makeHost({
      method: 'GET',
      openbucket: { requestId: 'rid-1', bucket: 'my-bucket', keyRaw: 'photos/2026/sunset.jpg' },
    });

    filter.catch(new NoSuchKeyError('photos/2026/sunset.jpg'), host);

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toBe('application/xml');
    expect(res.headers['x-amz-request-id']).toBe('rid-1');
    expect(res.body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Error>' +
        '<Code>NoSuchKey</Code>' +
        '<Message>The specified key does not exist.</Message>' +
        '<Key>photos/2026/sunset.jpg</Key>' +
        '<Resource>/my-bucket/photos/2026/sunset.jpg</Resource>' +
        '<RequestId>rid-1</RequestId>' +
        '<HostId>rid-1</HostId>' +
        '</Error>',
    );
    // Content-Length equals the exact UTF-8 byte length of the body.
    expect(res.headers['content-length']).toBe(Buffer.byteLength(res.body as string, 'utf8'));
  });

  it('case 2: HEAD on error → status + headers but zero-length body', () => {
    const { host, res } = makeHost({
      method: 'HEAD',
      openbucket: { requestId: 'rid-2', bucket: 'my-bucket', keyRaw: 'k' },
    });

    filter.catch(new NoSuchKeyError('k'), host);

    expect(res.statusCode).toBe(404);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    // Content-Length still reflects the would-be body, per §2.7.
    expect(res.headers['content-length']).toBeGreaterThan(0);
  });

  it('case 3: generic Error → 500 InternalError and logs at error level', () => {
    const { host, res } = makeHost({ method: 'GET', openbucket: { requestId: 'rid-3' } });

    filter.catch(new Error('boom'), host);

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('<Code>InternalError</Code>');
    expect(res.body).toContain(
      '<Message>We encountered an internal error. Please try again.</Message>',
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'InternalError', requestId: 'rid-3' }),
      's3 internal error',
    );
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('case 4: NestJS 405 → <Code>MethodNotAllowed</Code> and logs at debug level', () => {
    const { host, res } = makeHost({ method: 'POST', openbucket: { requestId: 'rid-4' } });

    filter.catch(new HttpException('nope', 405), host);

    expect(res.statusCode).toBe(405);
    expect(res.body).toContain('<Code>MethodNotAllowed</Code>');
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MethodNotAllowed', requestId: 'rid-4' }),
      's3 client error',
    );
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('case 5: headersSent → res.destroy(err) and no further write', () => {
    const { host, res } = makeHost(
      { method: 'GET', openbucket: { requestId: 'rid-5', bucket: 'b', keyRaw: 'k' } },
      { headersSent: true },
    );

    filter.catch(new NoSuchKeyError('k'), host);

    expect(res.destroyedWith).toBeInstanceOf(NoSuchKeyError);
    expect(res.statusCode).toBeUndefined();
    expect(res.ended).toBe(false);
    expect(res.body).toBeUndefined();
  });

  it('case 6: x-amz-request-id equals req.openbucket.requestId (or "unknown")', () => {
    const withId = makeHost({ method: 'GET', openbucket: { requestId: 'rid-6' } });
    filter.catch(new NoSuchKeyError('k'), withId.host);
    expect(withId.res.headers['x-amz-request-id']).toBe('rid-6');

    const noCtx = makeHost({ method: 'GET', openbucket: undefined });
    filter.catch(new NoSuchKeyError('k'), noCtx.host);
    expect(noCtx.res.headers['x-amz-request-id']).toBe('unknown');
  });

  it('resourceFor: falls back to "/" with a bucket-less context and originalUrl with no context', () => {
    const bucketOnly = makeHost({ method: 'GET', openbucket: { requestId: 'r', bucket: 'b' } });
    filter.catch(new NoSuchKeyError('k'), bucketOnly.host);
    expect(bucketOnly.res.body).toContain('<Resource>/b</Resource>');

    const noCtx = makeHost({ method: 'GET', originalUrl: '/raw/url', openbucket: undefined });
    filter.catch(new NoSuchKeyError('k'), noCtx.host);
    expect(noCtx.res.body).toContain('<Resource>/raw/url</Resource>');
  });

  it('resourceFor: uses ob.key when the classifier has not set keyRaw', () => {
    // The current classifier populates `key`, not `keyRaw`; the resource must
    // still reflect the full object path.
    const keyOnly = makeHost({
      method: 'GET',
      openbucket: { requestId: 'r', bucket: 'mybucket', key: 'some/key.txt' },
    });
    filter.catch(new NoSuchKeyError('some/key.txt'), keyOnly.host);
    expect(keyOnly.res.body).toContain('<Resource>/mybucket/some/key.txt</Resource>');
  });
});
