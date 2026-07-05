import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';

import type { AppConfigService } from '../config/app-config.service';
import type { Clock } from '../clock/clock';
import type { LifecycleService } from '../../domain/lifecycle/lifecycle.service';
import type { ObjectService } from '../../domain/objects/object.service';
import type { TieringService } from '../../domain/tiering/tiering.service';
import { ObjectLocation, StorageClass } from '../../persistence/index';
import {
  TIERING_BATCH_SIZE,
  TIERING_MAX_BATCHES_PER_TICK,
  TieringSweepRunner,
  type TransitionRule,
} from './tiering-sweep.runner';

/**
 * TEST-0901 — TieringSweepRunner: cold selection (last-access window), the
 * disabled/no-remote no-op, per-object failure isolation, cursor advance, and the
 * MAX_BATCHES_PER_TICK pause. All deps are mocked.
 */
const NOW = Date.parse('2026-07-05T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

type ScanRow = {
  bucket: string;
  key: string;
  location: ObjectLocation;
  size: number;
  lastAccessedAt?: Date;
  modifiedAt: Date;
};

function rule(over: Partial<TransitionRule> = {}): TransitionRule {
  return { ruleId: 'b/r1', bucket: 'b', prefix: '', days: 30, storageClass: StorageClass.Glacier, ...over };
}

function coldRow(key: string, ageDays: number, over: Partial<ScanRow> = {}): ScanRow {
  return {
    bucket: 'b',
    key,
    location: ObjectLocation.Local,
    size: 5,
    lastAccessedAt: new Date(NOW - ageDays * DAY),
    modifiedAt: new Date(NOW - ageDays * DAY),
    ...over,
  };
}

function build(opts: {
  rules: TransitionRule[];
  pages: ScanRow[][];
  tierEnabled?: boolean;
  remoteEnabled?: boolean;
  tierOutcome?: 'tiered' | 'skipped';
  tierThrows?: boolean;
}) {
  const lifecycle = {
    activeTransitionRules: jest.fn().mockResolvedValue(opts.rules),
    loadTieringCursor: jest.fn().mockResolvedValue(null),
    saveTieringCursor: jest.fn().mockResolvedValue(undefined),
  } as unknown as LifecycleService;

  const queue = [...opts.pages];
  const objects = {
    scanForTiering: jest.fn().mockImplementation(async () => queue.shift() ?? []),
  } as unknown as ObjectService;

  const tierToRemote = jest.fn().mockImplementation(async () => {
    if (opts.tierThrows) throw new Error('remote down');
    return opts.tierOutcome ?? 'tiered';
  });
  const tiering = {
    get remoteEnabled() {
      return opts.remoteEnabled ?? true;
    },
    tierToRemote,
  } as unknown as TieringService;

  const config = { tierEnabled: opts.tierEnabled ?? true } as unknown as AppConfigService;
  const clock = { nowMs: () => NOW, now: () => new Date(NOW) } as unknown as Clock;
  const em = {} as EntityManager;

  const runner = new TieringSweepRunner(em, lifecycle, objects, tiering, config, clock);
  return { runner, lifecycle, objects, tiering, tierToRemote };
}

describe('TieringSweepRunner (TEST-0901)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('exports the batch constants', () => {
    expect(TIERING_BATCH_SIZE).toBe(500);
    expect(TIERING_MAX_BATCHES_PER_TICK).toBe(10);
  });

  it('tiers only objects colder than the window; leaves warm ones LOCAL', async () => {
    const { runner, tierToRemote } = build({
      rules: [rule({ days: 30 })],
      pages: [[coldRow('cold', 40), coldRow('warm', 5)], []],
    });
    await runner.run();
    expect(tierToRemote).toHaveBeenCalledTimes(1);
    expect(tierToRemote).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'b', key: 'cold', storageClass: StorageClass.Glacier }),
    );
  });

  it('never tiers a non-LOCAL row (already remote)', async () => {
    const { runner, tierToRemote } = build({
      rules: [rule({ days: 30 })],
      pages: [[coldRow('remote', 90, { location: ObjectLocation.Remote })], []],
    });
    await runner.run();
    expect(tierToRemote).not.toHaveBeenCalled();
  });

  it('falls back to modifiedAt when lastAccessedAt is null', async () => {
    const { runner, tierToRemote } = build({
      rules: [rule({ days: 30 })],
      pages: [[coldRow('k', 45, { lastAccessedAt: undefined })], []],
    });
    await runner.run();
    expect(tierToRemote).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when tiering is disabled', async () => {
    const { runner, lifecycle, tierToRemote } = build({
      rules: [rule()],
      pages: [[coldRow('cold', 90)]],
      tierEnabled: false,
    });
    await runner.run();
    expect(lifecycle.activeTransitionRules).not.toHaveBeenCalled();
    expect(tierToRemote).not.toHaveBeenCalled();
  });

  it('is a no-op when no remote is configured', async () => {
    const { runner, lifecycle, tierToRemote } = build({
      rules: [rule()],
      pages: [[coldRow('cold', 90)]],
      remoteEnabled: false,
    });
    await runner.run();
    expect(lifecycle.activeTransitionRules).not.toHaveBeenCalled();
    expect(tierToRemote).not.toHaveBeenCalled();
  });

  it('advances the cursor to the last key of the page', async () => {
    const { runner, lifecycle } = build({
      rules: [rule({ days: 30 })],
      pages: [[coldRow('a', 90), coldRow('z', 90)], []],
    });
    await runner.run();
    expect(lifecycle.saveTieringCursor).toHaveBeenCalledWith('b/r1', 'z');
    expect(lifecycle.saveTieringCursor).toHaveBeenCalledWith('b/r1', null);
  });

  it('isolates a per-object failure and keeps sweeping (cursor still advances)', async () => {
    const { runner, lifecycle, tierToRemote } = build({
      rules: [rule({ days: 30 })],
      pages: [[coldRow('poison', 90)], []],
      tierThrows: true,
    });
    await expect(runner.run()).resolves.toBeUndefined();
    expect(tierToRemote).toHaveBeenCalledTimes(1);
    expect(lifecycle.saveTieringCursor).toHaveBeenCalledWith('b/r1', 'poison');
  });

  it('pauses after MAX_BATCHES_PER_TICK', async () => {
    const pages = Array.from({ length: TIERING_MAX_BATCHES_PER_TICK + 2 }, (_, i) => [
      coldRow(`k${i}`, 90),
    ]);
    const { runner, objects } = build({ rules: [rule({ days: 30 })], pages });
    await runner.run();
    expect(objects.scanForTiering).toHaveBeenCalledTimes(TIERING_MAX_BATCHES_PER_TICK);
  });
});
