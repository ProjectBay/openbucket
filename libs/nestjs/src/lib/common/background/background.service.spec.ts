import { Logger } from '@nestjs/common';

// RequestContext.create just invokes the callback (no real EM needed in unit tests).
jest.mock('@mikro-orm/core', () => ({
  MikroORM: class MikroORM {},
  RequestContext: { create: (_em: unknown, fn: () => Promise<void>) => fn() },
}));

import { BackgroundService, ScheduledTask } from './background.service';

/** TEST-0318 — BackgroundService scheduler (fake timers). */
const mkOrm = () => ({ em: {} }) as unknown as import('@mikro-orm/core').MikroORM;

describe('BackgroundService (TEST-0318)', () => {
  let svc: BackgroundService;

  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    await svc?.onApplicationShutdown(); // clear intervals + await in-flight ticks
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fires a scheduled runner on its interval', async () => {
    svc = new BackgroundService(mkOrm());
    const run = jest.fn().mockResolvedValue(undefined);
    svc.schedule('t', 1000, run);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips a firing while the previous tick is still running (no pile-up)', async () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    svc = new BackgroundService(mkOrm());
    let release!: () => void;
    const run = jest.fn().mockReturnValue(new Promise<void>((r) => (release = r)));

    svc.schedule('slow', 1000, run);
    await jest.advanceTimersByTimeAsync(1000); // fire 1 → runner pending
    await jest.advanceTimersByTimeAsync(1000); // fire 2 → skipped

    expect(run).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Skipping slow'));
    release();
  });

  it('warns when a tick exceeds 80% of its interval', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    svc = new BackgroundService(mkOrm());
    const run = jest.fn().mockImplementation(async () => {
      jest.setSystemTime(Date.now() + 900); // 90% of the 1000 ms interval
    });

    svc.schedule('heavy', 1000, run);
    await jest.advanceTimersByTimeAsync(1000);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('risk of pile-up'));
  });

  it('logs and swallows a tick error (does not crash the loop)', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    svc = new BackgroundService(mkOrm());
    const run = jest.fn().mockRejectedValue(new Error('boom'));

    svc.schedule('failing', 1000, run);
    await jest.advanceTimersByTimeAsync(1000);
    // still scheduled — fires again next interval
    await jest.advanceTimersByTimeAsync(1000);

    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('Tick failing failed', expect.any(Error));
  });

  it('onApplicationBootstrap schedules the registered SCHEDULED_TASKS', async () => {
    const task: ScheduledTask = {
      name: 'mp-cleanup',
      intervalMs: 1000,
      run: jest.fn().mockResolvedValue(undefined),
    };
    svc = new BackgroundService(mkOrm(), [task]);
    svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1000);
    expect(task.run).toHaveBeenCalledTimes(1);
  });

  it('onApplicationShutdown clears intervals so no further ticks fire', async () => {
    svc = new BackgroundService(mkOrm());
    const run = jest.fn().mockResolvedValue(undefined);
    svc.schedule('t', 1000, run);
    await svc.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
