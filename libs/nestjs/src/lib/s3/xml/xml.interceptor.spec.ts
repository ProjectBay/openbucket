import { EventEmitter } from 'events';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { lastValueFrom, of } from 'rxjs';

import { MalformedXMLError } from '../errors/s3-error';
import { MAX_XML_BYTES, XmlInterceptor } from './xml.interceptor';
import { XmlParser } from './xml.parser';
import { XmlSerializer } from './xml.serializer';

/**
 * TEST-0102 — XmlInterceptor unit (cases 6-10).
 */

interface ResCapture {
  headers: Record<string, string | number>;
}

function makeReq(opts: { method: string; operation?: string }): Request {
  const req = new EventEmitter() as unknown as Request & {
    destroy: jest.Mock;
    method: string;
  };
  req.method = opts.method;
  // Mirror the OpenBucketRequestContext shape that the classifier middleware
  // populates; only `operation` is load-bearing for the interceptor's gate.
  req.openbucket = {
    requestId: 'r',
    kind: 's3',
    receivedAt: 0,
    ...(opts.operation ? { operation: opts.operation } : {}),
  };
  req.destroy = jest.fn();
  return req as Request;
}

function makeRes(): { res: Response; cap: ResCapture } {
  const cap: ResCapture = { headers: {} };
  const res = {
    setHeader: (k: string, v: string | number) => {
      cap.headers[k] = v;
    },
  } as unknown as Response;
  return { res, cap };
}

function makeCtx(req: Request, res: Response): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as unknown as T,
      getResponse: <T>() => res as unknown as T,
    }),
  } as ExecutionContext;
}

describe('XmlInterceptor (TEST-0102 cases 6-10)', () => {
  const interceptor = new XmlInterceptor(new XmlParser(), new XmlSerializer());

  // ---------- case 6: inbound parse on a known XML op --------------------

  it('case 6: PUT + PutBucketTagging buffers, parses, attaches req.xmlBody', async () => {
    const req = makeReq({ method: 'PUT', operation: 'PutBucketTagging' });
    const { res } = makeRes();
    const ctx = makeCtx(req, res);
    const next: CallHandler = { handle: () => of(undefined) };

    const xml =
      `<Tagging><TagSet>` +
      `<Tag><Key>env</Key><Value>prod</Value></Tag>` +
      `</TagSet></Tagging>`;

    const obs = interceptor.intercept(ctx, next);
    // Emit body on the next tick so the interceptor's data/end listeners
    // (attached synchronously inside readXmlBody) are in place when we push.
    setImmediate(() => {
      req.emit('data', Buffer.from(xml, 'utf8'));
      req.emit('end');
    });

    await lastValueFrom(obs);

    const parsed = (req as unknown as { xmlBody: unknown }).xmlBody as {
      Tagging: { TagSet: { Tag: Array<{ Key: string; Value: string }> } };
    };
    expect(Array.isArray(parsed.Tagging.TagSet.Tag)).toBe(true);
    expect(parsed.Tagging.TagSet.Tag[0]).toEqual({ Key: 'env', Value: 'prod' });
  });

  // ---------- case 7: oversized inbound body -----------------------------

  it('case 7: body > MAX_XML_BYTES rejects with MalformedXMLError', async () => {
    const req = makeReq({ method: 'PUT', operation: 'PutBucketTagging' });
    const { res } = makeRes();
    const ctx = makeCtx(req, res);
    const next: CallHandler = { handle: () => of(undefined) };

    const obs = interceptor.intercept(ctx, next);
    setImmediate(() => {
      // 257 KB — one byte over the limit.
      req.emit('data', Buffer.alloc(MAX_XML_BYTES + 1, 0x20));
    });

    await expect(lastValueFrom(obs)).rejects.toThrow(MalformedXMLError);
    expect((req as unknown as { destroy: jest.Mock }).destroy).toHaveBeenCalled();
  });

  // ---------- case 8: Buffer outbound pass-through -----------------------

  it('case 8: Buffer return passes through unchanged with no XML headers', async () => {
    // GET short-circuits the inbound branch entirely.
    const req = makeReq({ method: 'GET' });
    const { res, cap } = makeRes();
    const ctx = makeCtx(req, res);
    const payload = Buffer.from('binary');
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(result).toBe(payload);
    expect(cap.headers['Content-Type']).toBeUndefined();
    expect(cap.headers['Content-Length']).toBeUndefined();
  });

  // ---------- case 9: __raw envelope outbound pass-through ---------------

  it('case 9: { __raw: true, … } return passes through unchanged', async () => {
    const req = makeReq({ method: 'GET' });
    const { res, cap } = makeRes();
    const ctx = makeCtx(req, res);
    const env = { __raw: true, body: 'precomputed' };
    const next: CallHandler = { handle: () => of(env) };

    const result = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(result).toBe(env);
    expect(cap.headers['Content-Type']).toBeUndefined();
    expect(cap.headers['Content-Length']).toBeUndefined();
  });

  // ---------- case 10: POJO -> XML envelope + headers --------------------

  it('case 10: POJO with __root serializes and sets XML headers', async () => {
    const req = makeReq({ method: 'GET' });
    const { res, cap } = makeRes();
    const ctx = makeCtx(req, res);
    const next: CallHandler = {
      handle: () => of({ __root: 'ListBucketResult', Name: 'b' }),
    };

    const result = (await lastValueFrom(
      interceptor.intercept(ctx, next),
    )) as string;

    expect(typeof result).toBe('string');
    expect(result).toContain('<ListBucketResult');
    expect(result).toContain('<Name>b</Name>');
    expect(result).not.toMatch(/__root/);
    expect(cap.headers['Content-Type']).toBe('application/xml');
    expect(cap.headers['Content-Length']).toBe(
      Buffer.byteLength(result, 'utf8'),
    );
  });
});
