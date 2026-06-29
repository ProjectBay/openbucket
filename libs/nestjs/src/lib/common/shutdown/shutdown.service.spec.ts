import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import type { MikroORM } from '@mikro-orm/core';

import { ShutdownService } from './shutdown.service';
import { ShutdownState } from '../shutdown-state.service';
import type { BackgroundService } from '../background/background.service';
import type { BlobStore } from '../../storage/blob-store';

/**
 * TEST-0326 — ShutdownService 5-step ordering (§4.12). Pure unit: the http
 * server, BackgroundService, BlobStore and MikroORM are fakes that record the
 * order in which they're touched. Logger output is silenced.
 */

/** A fake http.Server: an EventEmitter with a close(cb) that records + invokes. */
function fakeServer(order: string[]): EventEmitter & { close: (cb: () => void) => void } {
  const srv = new EventEmitter() as EventEmitter & { close: (cb: () => void) => void };
  srv.close = (cb: () => void) => {
    order.push('server.close');
    cb();
  };
  return srv;
}

/** A fake accepted socket — an EventEmitter with the writable/end/destroy seam. */
function fakeSocket(writable = true): EventEmitter & {
  writable: boolean;
  writableNeedDrain: boolean;
  end: jest.Mock;
  destroy: jest.Mock;
} {
  const s = new EventEmitter() as EventEmitter & {
    writable: boolean;
    writableNeedDrain: boolean;
    end: jest.Mock;
    destroy: jest.Mock;
  };
  s.writable = writable;
  s.writableNeedDrain = false;
  s.end = jest.fn();
  s.destroy = jest.fn();
  return s;
}

interface Harness {
  svc: ShutdownService;
  server: ReturnType<typeof fakeServer>;
  order: string[];
  background: BackgroundService;
  blobs: BlobStore;
  orm: MikroORM;
  state: ShutdownState;
}

function build(): Harness {
  const order: string[] = [];
  const server = fakeServer(order);
  const adapterHost = {
    httpAdapter: { getHttpServer: () => server },
  } as unknown as HttpAdapterHost;
  const background = {
    onApplicationShutdown: jest.fn(async () => {
      order.push('background');
    }),
  } as unknown as BackgroundService;
  const blobs = {
    close: jest.fn(async () => {
      order.push('blobs');
    }),
  } as unknown as BlobStore;
  const orm = {
    close: jest.fn(async () => {
      order.push('orm');
    }),
  } as unknown as MikroORM;
  const state = new ShutdownState();
  jest.spyOn(state, 'beginShutdown').mockImplementation(() => {
    order.push('state');
  });

  const svc = new ShutdownService(adapterHost, background, blobs, orm, state);
  return { svc, server, order, background, blobs, orm, state };
}

describe('ShutdownService (TEST-0326)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Silence the info logs the service emits; the binding is intentionally
    // dropped (only the mock side-effect matters).
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('case 1: runs the five steps in the load-bearing order', async () => {
    const h = build();
    await h.svc.onApplicationShutdown('SIGTERM');

    // readiness → server close → background → blobs → orm.
    expect(h.order).toEqual(['state', 'server.close', 'background', 'blobs', 'orm']);
    expect(h.background.onApplicationShutdown).toHaveBeenCalledTimes(1);
    expect(h.blobs.close).toHaveBeenCalledTimes(1);
  });

  it('case 2: closes MikroORM last with force=true (WAL checkpoint)', async () => {
    const h = build();
    await h.svc.onApplicationShutdown('SIGTERM');
    expect(h.orm.close).toHaveBeenCalledWith(true);
  });

  it('case 3: step 1 ends idle keep-alive sockets but not ones mid-write', async () => {
    const h = build();
    const idle = fakeSocket(true);
    idle.end = jest.fn(() => idle.emit('close')); // end() closes it (real socket behaviour)
    const draining = fakeSocket(true);
    draining.writableNeedDrain = true; // mid-write: must NOT be end()'d
    h.server.emit('connection', idle);
    h.server.emit('connection', draining);

    // Step 1 runs synchronously in the server.close executor: idle is end()'d
    // (→ closes → removed); draining is skipped. Then it finishes its in-flight
    // write on its own, clearing the drain loop.
    const done = h.svc.onApplicationShutdown('SIGTERM');
    draining.emit('close');
    await done;

    expect(idle.end).toHaveBeenCalledTimes(1);
    expect(draining.end).not.toHaveBeenCalled();
  });

  it('case 4: a socket whose close fires removes it from tracking (no end at shutdown)', async () => {
    const h = build();
    const sock = fakeSocket(true);
    h.server.emit('connection', sock);
    sock.emit('close'); // socket gone before shutdown

    await h.svc.onApplicationShutdown('SIGTERM');

    expect(sock.end).not.toHaveBeenCalled();
    expect(sock.destroy).not.toHaveBeenCalled();
  });

  it('case 5: at the 30s drain deadline, survivors are destroyed and a warning is logged', async () => {
    jest.useFakeTimers();
    const h = build();
    const stuck = fakeSocket(true);
    h.server.emit('connection', stuck); // never emits 'close' → stays in the set

    const done = h.svc.onApplicationShutdown('SIGTERM');
    // Drive the 100ms poll loop past the 30_000ms deadline.
    await jest.advanceTimersByTimeAsync(30_100);
    await done;

    expect(stuck.destroy).toHaveBeenCalledTimes(1);
    const warned = warnSpy.mock.calls
      .flat()
      .some((a) => typeof a === 'string' && a.includes('Drain deadline reached with 1 sockets'));
    expect(warned).toBe(true);
  });

  it('case 6: with no httpServer (test harness), it still runs steps 3–5', async () => {
    const order: string[] = [];
    const adapterHost = { httpAdapter: undefined } as unknown as HttpAdapterHost;
    const background = {
      onApplicationShutdown: jest.fn(async () => order.push('background')),
    } as unknown as BackgroundService;
    const blobs = { close: jest.fn(async () => order.push('blobs')) } as unknown as BlobStore;
    const orm = { close: jest.fn(async () => order.push('orm')) } as unknown as MikroORM;
    const state = new ShutdownState();

    const svc = new ShutdownService(adapterHost, background, blobs, orm, state);
    await svc.onApplicationShutdown(undefined);

    expect(order).toEqual(['background', 'blobs', 'orm']);
    expect(orm.close).toHaveBeenCalledWith(true);
  });
});
