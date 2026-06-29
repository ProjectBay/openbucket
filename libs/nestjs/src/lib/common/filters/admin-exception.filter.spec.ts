import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

import { ZodValidationPipe as ReexportedPipe } from '../pipes/zod-validation.pipe';
import { AdminExceptionFilter } from './admin-exception.filter';
import { CatchAllExceptionFilter } from './catch-all.filter';

/**
 * TEST-0011 — admin filter, catch-all filter, Zod pipe wiring.
 */
interface ResCapture {
  status?: number;
  json?: unknown;
  ended?: boolean;
}

function makeHost(openbucket: unknown): { host: ArgumentsHost; res: ResCapture } {
  const res: ResCapture = {};
  const response = {
    status: (s: number) => {
      res.status = s;
      return response;
    },
    json: (b: unknown) => {
      res.json = b;
      return response;
    },
    end: () => {
      res.ended = true;
      return response;
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

function twoIssueZodError(): z.ZodError {
  const schema = z.object({ a: z.string(), b: z.number() });
  const parsed = schema.safeParse({ a: 1, b: 'x' });
  if (parsed.success) throw new Error('expected parse failure');
  return parsed.error;
}

describe('AdminExceptionFilter', () => {
  let filter: AdminExceptionFilter;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AdminExceptionFilter();
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errSpy.mockRestore());

  it('case 1: re-throws when kind !== admin', () => {
    const { host, res } = makeHost({ kind: 's3', requestId: 'x' });
    expect(() => filter.catch(new Error('y'), host)).toThrow('y');
    expect(res.status).toBeUndefined();
  });

  it('case 2: ZodValidationException → 400 with issues + requestId', () => {
    const { host, res } = makeHost({ kind: 'admin', requestId: 'rid-1' });
    filter.catch(new ZodValidationException(twoIssueZodError()), host);

    expect(res.status).toBe(400);
    const body = res.json as Record<string, unknown>;
    expect(body.error).toBe('ValidationFailed');
    expect(body.message).toBe('Request payload failed validation.');
    expect(body.requestId).toBe('rid-1');
    expect(Array.isArray(body.issues)).toBe(true);
    expect((body.issues as unknown[]).length).toBe(2);
  });

  it('case 3: object HttpException merges requestId', () => {
    const { host, res } = makeHost({ kind: 'admin', requestId: 'rid-1' });
    filter.catch(new HttpException({ error: 'NotFound', message: 'bucket not found' }, 404), host);

    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'NotFound', message: 'bucket not found', requestId: 'rid-1' });
  });

  it('case 4: string HttpException becomes { error, requestId }', () => {
    const { host, res } = makeHost({ kind: 'admin', requestId: 'rid-1' });
    filter.catch(new HttpException('plain', 418), host);

    expect(res.status).toBe(418);
    expect(res.json).toEqual({ error: 'plain', requestId: 'rid-1' });
  });

  it('case 5: unknown error → 500 + logs', () => {
    const { host, res } = makeHost({ kind: 'admin', requestId: 'rid-1' });
    filter.catch(new Error('kaboom'), host);

    expect(res.status).toBe(500);
    expect(res.json).toEqual({
      error: 'InternalError',
      message: 'An unexpected error occurred.',
      requestId: 'rid-1',
    });
    expect(errSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'rid-1' }),
      'Admin 5xx',
    );
  });
});

describe('CatchAllExceptionFilter', () => {
  it('case 6: returns bare 500 and logs', () => {
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filter = new CatchAllExceptionFilter();
    const { host, res } = makeHost(undefined);

    filter.catch(new Error('weird'), host);

    expect(res.status).toBe(500);
    expect(res.ended).toBe(true);
    expect(res.json).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('ZodValidationPipe re-export', () => {
  it('case 7: re-exported pipe is identical to nestjs-zod export', () => {
    expect(ReexportedPipe).toBe(ZodValidationPipe);
  });
});
