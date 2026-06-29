import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { InvalidArgumentError, NoSuchBucketError } from '../../s3/errors/s3-error';
import { S3ExceptionFilter } from './s3-exception.filter';

/**
 * TEST-0010 — S3ExceptionFilter scaffold behaviour.
 */
interface ResCapture {
  status?: number;
  headers: Record<string, string>;
  body?: string;
}

function makeHost(openbucket: unknown): { host: ArgumentsHost; res: ResCapture } {
  const res: ResCapture = { headers: {} };
  const response = {
    status: (s: number) => {
      res.status = s;
      return response;
    },
    setHeader: (k: string, v: string) => {
      res.headers[k.toLowerCase()] = v;
    },
    send: (b: string) => {
      res.body = b;
    },
  } as unknown as Response;
  const request = { openbucket } as unknown as Request;

  const host = {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
    }),
  } as ArgumentsHost;

  return { host, res };
}

describe('S3ExceptionFilter', () => {
  let filter: S3ExceptionFilter;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new S3ExceptionFilter();
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errSpy.mockRestore());

  it('case 1: re-throws for non-s3 requests and does not write res', () => {
    const { host, res } = makeHost({ kind: 'admin', requestId: 'r1' });
    expect(() => filter.catch(new Error('x'), host)).toThrow('x');
    expect(res.body).toBeUndefined();
    expect(res.status).toBeUndefined();
  });

  it('case 2: maps S3Error to XML with status, headers, and body', () => {
    const { host, res } = makeHost({
      kind: 's3',
      requestId: 'req-7',
      bucket: 'b',
      key: 'k',
    });
    filter.catch(new NoSuchBucketError('b'), host);

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('application/xml');
    expect(res.headers['x-amz-request-id']).toBe('req-7');
    expect(res.body).toContain(
      '<Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message>',
    );
    expect(res.body).toContain('<Resource>/b/k</Resource>');
    expect(res.body?.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Error>')).toBe(true);
  });

  it('case 3: generic Error → 500 InternalError and logs', () => {
    const { host, res } = makeHost({ kind: 's3', requestId: 'r3' });
    filter.catch(new Error('boom'), host);

    expect(res.status).toBe(500);
    expect(res.body).toContain('<Code>InternalError</Code>');
    expect(res.body).toContain('<Message>We encountered an internal error.</Message>');
    expect(errSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r3', code: 'InternalError' }),
      'S3 5xx',
    );
  });

  it('case 4: escapes XML entities in the resource path', () => {
    const { host, res } = makeHost({
      kind: 's3',
      requestId: 'r4',
      bucket: 'b',
      key: `a<b>&"'`,
    });
    filter.catch(new InvalidArgumentError('bad'), host);

    expect(res.body).toContain('a&lt;b&gt;&amp;&quot;&apos;');
    expect(res.body).not.toContain('a<b>');
  });

  it('case 5: HttpException maps to its status with InternalError code', () => {
    const { host, res } = makeHost({ kind: 's3', requestId: 'r5' });
    filter.catch(new HttpException('boom', 418), host);

    expect(res.status).toBe(418);
    expect(res.body).toContain('<Code>InternalError</Code>');
    expect(res.body).toContain('<Message>boom</Message>');
  });
});
