import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import { ShutdownTrackerInterceptor } from './interceptors/shutdown-tracker.interceptor';
import { ShutdownState } from './shutdown-state.service';

/**
 * TEST-0015 — ShutdownState semantics + tracker interceptor.
 */
describe('ShutdownState', () => {
  let state: ShutdownState;

  beforeEach(() => {
    state = new ShutdownState();
  });

  it('case 1: enter/enter/leave leaves inFlight at 1', () => {
    state.enter();
    state.enter();
    state.leave();
    expect(state.inFlight).toBe(1);
  });

  it('case 2: leave() floors at zero', () => {
    state.leave();
    expect(state.inFlight).toBe(0);
  });

  it('case 3: whenDrained awaiters all resolve and the queue empties', async () => {
    state.enter();
    state.enter();
    const a = state.whenDrained();
    const b = state.whenDrained();
    state.leave();
    expect(state.inFlight).toBe(1);
    state.leave();
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
    // A subsequent whenDrained resolves synchronously => queue did not leak.
    await expect(state.whenDrained()).resolves.toBeUndefined();
  });

  it('case 4: whenDrained resolves immediately when idle', async () => {
    await expect(state.whenDrained()).resolves.toBeUndefined();
  });

  it('case 5: beginShutdown is idempotent and aborts the controller', () => {
    expect(state.abortController.signal.aborted).toBe(false);
    state.beginShutdown();
    state.beginShutdown();
    expect(state.isShuttingDown).toBe(true);
    expect(state.abortController.signal.aborted).toBe(true);
  });
});

describe('ShutdownTrackerInterceptor', () => {
  const ctx = {} as ExecutionContext;

  it('case 6: increments before emission and decrements on completion', async () => {
    const state = new ShutdownState();
    const interceptor = new ShutdownTrackerInterceptor(state);

    const handler: CallHandler = {
      handle: () => {
        // enter() must already have run by the time handle() is consumed.
        expect(state.inFlight).toBe(1);
        return of('ok');
      },
    };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBe('ok');
    expect(state.inFlight).toBe(0);
  });

  it('case 7: decrements via finalize on the error path', async () => {
    const state = new ShutdownState();
    const interceptor = new ShutdownTrackerInterceptor(state);

    const handler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(lastValueFrom(interceptor.intercept(ctx, handler))).rejects.toThrow('boom');
    expect(state.inFlight).toBe(0);
  });
});
