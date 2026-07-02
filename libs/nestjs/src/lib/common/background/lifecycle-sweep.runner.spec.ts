import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';

import { Clock } from '../clock/clock';
import { LifecycleService } from '../../domain/lifecycle/lifecycle.service';
import { ObjectService } from '../../domain/objects/object.service';
import {
  BATCH_SIZE,
  ExpirationRule,
  LifecycleSweepRunner,
  MAX_BATCHES_PER_TICK,
} from './lifecycle-sweep.runner';

/**
 * TEST-0319 — LifecycleSweepRunner: days/date expiration eval, per-rule cursor
 * paging, transactional moveToTrash, setImmediate yielding, and the
 * MAX_BATCHES_PER_TICK pause. EntityManager/LifecycleService/ObjectService/Clock
 * are mocked; setImmediate is spied to observe yields.
 */
const NOW = Date.parse('2026-06-10T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
type ScanRow = { bucket: string; key: string; createdAt: Date };

function rule(over: Partial<ExpirationRule> = {}): ExpirationRule {
  return { ruleId: 'b/r1', bucket: 'b', prefix: '', days: 7, ...over };
}

function build(opts: {
  rules: ExpirationRule[];
  pages: ScanRow[][]; // consumed in order across all scanForLifecycle calls
  cursor?: string | null;
}) {
  const lifecycle = {
    activeExpirationRules: jest.fn().mockResolvedValue(opts.rules),
    loadCursor: jest.fn().mockResolvedValue(opts.cursor ?? null),
    saveCursor: jest.fn().mockResolvedValue(undefined),
  } as unknown as LifecycleService;

  const queue = [...opts.pages];
  const objects = {
    scanForLifecycle: jest.fn().mockImplementation(async () => queue.shift() ?? []),
    moveToTrash: jest.fn().mockResolvedValue(undefined),
  } as unknown as ObjectService;

  const txEm = {} as EntityManager;
  const em = {
    transactional: jest.fn().mockImplementation(async (cb: (em: EntityManager) => Promise<void>) => cb(txEm)),
  } as unknown as EntityManager;

  const clock = { nowMs: () => NOW } as unknown as Clock;
  const runner = new LifecycleSweepRunner(em, lifecycle, objects, clock);
  return { runner, lifecycle, objects, em, txEm };
}

const row = (key: string, ageDays: number): ScanRow => ({
  bucket: 'b',
  key,
  createdAt: new Date(NOW - ageDays * DAY),
});

describe('LifecycleSweepRunner (TEST-0319)', () => {
  let logSpy: jest.SpyInstance;
  let immediateSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    immediateSpy = jest.spyOn(global, 'setImmediate');
  });
  afterEach(() => jest.restoreAllMocks());

  it('exports BATCH_SIZE=500 and MAX_BATCHES_PER_TICK=10', () => {
    expect(BATCH_SIZE).toBe(500);
    expect(MAX_BATCHES_PER_TICK).toBe(10);
  });

  it('case 1: days-based isExpired (8d expired, 6d not)', () => {
    const { runner } = build({ rules: [rule()], pages: [] });
    const r = rule({ days: 7 });
    const isExpired = (o: { createdAt: Date }) =>
      (runner as unknown as { isExpired(o: unknown, r: ExpirationRule, n: Date): boolean }).isExpired(
        o,
        r,
        new Date(NOW),
      );
    expect(isExpired({ createdAt: new Date(NOW - 8 * DAY) })).toBe(true);
    expect(isExpired({ createdAt: new Date(NOW - 6 * DAY) })).toBe(false);
  });

  it('case 2: date-based isExpired (after → true, before → false)', () => {
    const { runner } = build({ rules: [rule()], pages: [] });
    const r = rule({ days: undefined, date: new Date('2026-01-01T00:00:00.000Z') });
    const isExpired = (now: Date) =>
      (runner as unknown as { isExpired(o: unknown, r: ExpirationRule, n: Date): boolean }).isExpired(
        { createdAt: new Date(0) },
        r,
        now,
      );
    expect(isExpired(new Date('2026-01-02T00:00:00.000Z'))).toBe(true);
    expect(isExpired(new Date('2025-12-31T00:00:00.000Z'))).toBe(false);
  });

  it('case 3: initial cursor is passed to scanForLifecycle as afterKey/limit', async () => {
    const { runner, objects } = build({ rules: [rule()], pages: [[]], cursor: 'k0' });
    await runner.run();
    expect(objects.scanForLifecycle).toHaveBeenCalledWith({
      bucket: 'b',
      prefix: '',
      afterKey: 'k0',
      limit: BATCH_SIZE,
    });
  });

  it('case 4: non-empty batch saves cursor = last key of page', async () => {
    const { runner, lifecycle } = build({
      rules: [rule()],
      pages: [[row('a', 8), row('z', 8)], []],
    });
    await runner.run();
    expect(lifecycle.saveCursor).toHaveBeenCalledWith('b/r1', 'z');
  });

  it('case 5: empty page saves null cursor and breaks', async () => {
    const { runner, lifecycle, objects } = build({ rules: [rule()], pages: [[]] });
    await runner.run();
    expect(lifecycle.saveCursor).toHaveBeenCalledWith('b/r1', null);
    expect(objects.scanForLifecycle).toHaveBeenCalledTimes(1);
  });

  it('case 6: expired objects are moved to trash inside em.transactional', async () => {
    const { runner, em, objects } = build({
      rules: [rule({ days: 7 })],
      pages: [[row('old', 10), row('fresh', 1)], []],
    });
    await runner.run();
    expect(em.transactional).toHaveBeenCalledTimes(1);
    expect(objects.moveToTrash).toHaveBeenCalledTimes(1);
    expect(objects.moveToTrash).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'b', key: 'old' }),
    );
    expect(logSpy).toHaveBeenCalledWith('Rule b/r1 expired 1/2 in batch');
  });

  it('case 7: yields via setImmediate between batches', async () => {
    const { runner } = build({ rules: [rule()], pages: [[row('a', 8)], []] });
    await runner.run();
    expect(immediateSpy).toHaveBeenCalled();
  });

  it('case 8: hitting MAX_BATCHES_PER_TICK logs the pause line', async () => {
    // Every scan returns a non-empty page, so the loop never exhausts the rule.
    const pages = Array.from({ length: MAX_BATCHES_PER_TICK + 2 }, (_, i) => [row(`k${i}`, 8)]);
    const { runner, objects } = build({ rules: [rule()], pages });
    await runner.run();
    expect(objects.scanForLifecycle).toHaveBeenCalledTimes(MAX_BATCHES_PER_TICK);
    expect(logSpy).toHaveBeenCalledWith(
      `Rule b/r1 paused at cursor k${MAX_BATCHES_PER_TICK - 1}; resumes next tick`,
    );
  });

  it('case 9: multiple rules are processed sequentially', async () => {
    const { runner, lifecycle, objects } = build({
      rules: [rule({ ruleId: 'b/r1', bucket: 'b' }), rule({ ruleId: 'c/r1', bucket: 'c' })],
      pages: [[], []],
    });
    await runner.run();
    expect(lifecycle.loadCursor).toHaveBeenCalledWith('b/r1');
    expect(lifecycle.loadCursor).toHaveBeenCalledWith('c/r1');
    expect(objects.scanForLifecycle).toHaveBeenCalledTimes(2);
  });
});
