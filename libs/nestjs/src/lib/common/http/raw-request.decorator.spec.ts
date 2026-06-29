import type { ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import * as barrel from './index';
import { RawReq, rawRequestFactory } from './raw-request.decorator';

/** TEST-0300 — RawReq decorator unit. */
function ctxWith(req: Partial<IncomingMessage>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: <T>() => req as T }),
  } as unknown as ExecutionContext;
}

describe('RawReq decorator (TEST-0300)', () => {
  it('case 1: returns the same IncomingMessage when the stream is unconsumed', () => {
    const req = { readableEnded: false } as IncomingMessage;
    expect(rawRequestFactory(undefined, ctxWith(req))).toBe(req);
  });

  it('case 2: throws the documented error when readableEnded is true', () => {
    const req = { readableEnded: true } as IncomingMessage;
    expect(() => rawRequestFactory(undefined, ctxWith(req))).toThrow(
      'RawReq: request stream already consumed.',
    );
  });

  it('case 3: RawReq is re-exported from the common/http barrel', () => {
    expect(barrel.RawReq).toBe(RawReq);
    expect(typeof RawReq).toBe('function');
  });
});
