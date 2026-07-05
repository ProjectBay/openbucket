import { Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';

import type { AppConfigService } from '../config/app-config.service';
import { IntegrityStatus } from '../../persistence/entities/types';
import type { ObjectRepository } from '../../persistence/repositories/object.repository';
import type { IntegrityVerifier } from '../../storage/integrity-verifier.service';
import type { IntegrityRepairService } from '../../storage/integrity-repair.service';
import { IntegrityScrubRunner } from './integrity-scrub.runner';

/**
 * TEST-1204 — IntegrityScrubRunner: the default-off gate, per-object corrupt/ok
 * verdicts, throttle/cursor persistence, ENOENT isolation, and the repair hand-off.
 * All deps are mocked.
 */
type ScanRow = {
  bucket: { name: string };
  key: string;
  contentSha256: string;
  encryption?: { iv: string };
};

const row = (key: string, sha = 'a'.repeat(64)): ScanRow => ({
  bucket: { name: 'b' },
  key,
  contentSha256: sha,
});

function build(opts: {
  enabled?: boolean;
  pages: ScanRow[][];
  verify?: (r: ScanRow) => { ok: boolean; actualSha256: string; bytesHashed: bigint };
  verifyThrows?: (r: ScanRow) => Error | undefined;
  maxObjects?: number;
  maxBytes?: number;
  repairOutcome?: 'repaired' | 'skipped-no-target' | 'failed';
}) {
  const state = {
    id: 'default',
    cursorBucket: null as string | null,
    cursorKey: null as string | null,
    lastRunAt: undefined as Date | undefined,
    scanned: 0,
    corruptFound: 0,
    repaired: 0,
  };

  const queue = [...opts.pages];
  const scanForScrub = jest.fn().mockImplementation(async () => queue.shift() ?? []);
  const objects = { scanForScrub } as unknown as ObjectRepository;

  const forkFindOne = jest.fn().mockImplementation(async (_e, where: { key: string }) => ({
    contentSha256: 'a'.repeat(64),
    key: where.key,
  }));
  const nativeUpdate = jest.fn().mockResolvedValue(1);
  const em = {
    findOne: jest.fn().mockResolvedValue(state),
    create: jest.fn(),
    persistAndFlush: jest.fn().mockResolvedValue(undefined),
    nativeUpdate,
    fork: () => ({ findOne: forkFindOne }),
  } as unknown as EntityManager;

  const verify = jest.fn().mockImplementation(async (_b: string, key: string) => {
    const r = { bucket: { name: 'b' }, key } as ScanRow;
    const t = opts.verifyThrows?.(r);
    if (t) throw t;
    return (
      opts.verify?.(r) ?? { ok: true, actualSha256: 'a'.repeat(64), bytesHashed: 10n }
    );
  });
  const verifier = { verify } as unknown as IntegrityVerifier;

  const repair = {
    repair: jest.fn().mockResolvedValue(opts.repairOutcome ?? 'skipped-no-target'),
  } as unknown as IntegrityRepairService;

  const config = {
    integrityScrubEnabled: opts.enabled ?? true,
    integrityScrubIntervalMs: 60_000,
    integrityScrubMaxObjectsPerTick: opts.maxObjects ?? 1000,
    integrityScrubMaxBytesPerTick: opts.maxBytes ?? 1_073_741_824,
  } as unknown as AppConfigService;

  const runner = new IntegrityScrubRunner(em, objects, verifier, config, repair);
  return { runner, em, objects, verifier, repair, state, scanForScrub, verify, nativeUpdate };
}

describe('IntegrityScrubRunner (TEST-1204)', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());

  it('case 1: disabled + no manual kick → returns before any repo/blob access', async () => {
    const { runner, em, scanForScrub, verify } = build({ enabled: false, pages: [] });
    await runner.run();
    expect(em.findOne).not.toHaveBeenCalled();
    expect(scanForScrub).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('case 2: an intact blob is marked ok, a flipped blob is marked corrupt', async () => {
    const { runner, state, nativeUpdate } = build({
      pages: [[row('ok1'), row('bad1')], []],
      verify: (r) =>
        r.key === 'bad1'
          ? { ok: false, actualSha256: 'f'.repeat(64), bytesHashed: 20n }
          : { ok: true, actualSha256: 'a'.repeat(64), bytesHashed: 10n },
    });
    await runner.run();

    const calls = nativeUpdate.mock.calls;
    const okCall = calls.find((c) => c[1].key === 'ok1');
    const badCall = calls.find((c) => c[1].key === 'bad1');
    expect(okCall[2].integrityStatus).toBe(IntegrityStatus.Ok);
    expect(okCall[2].integrityDetail).toBeNull();
    expect(badCall[2].integrityStatus).toBe(IntegrityStatus.Corrupt);
    expect(badCall[2].integrityCheckedAt).toBeInstanceOf(Date);
    expect(state.scanned).toBe(2);
    expect(state.corruptFound).toBe(1);
    // Full pass complete → cursor reset.
    expect(state.cursorBucket).toBeNull();
  });

  it('case 3: hitting MAX_OBJECTS_PER_TICK persists the cursor and stops', async () => {
    const { runner, state, scanForScrub } = build({
      pages: [[row('k1'), row('k2'), row('k3')]],
      maxObjects: 2,
    });
    await runner.run();
    // Stopped after 2 objects: cursor at k2, and the empty-page reset never ran.
    expect(state.cursorKey).toBe('k2');
    expect(state.cursorBucket).toBe('b');
    // Only the first page was fetched (the tick stopped before requesting more).
    expect(scanForScrub).toHaveBeenCalledTimes(1);
  });

  it('case 4: an ENOENT blob is left unchecked (not corrupt) and the cursor advances', async () => {
    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const { runner, state, nativeUpdate } = build({
      pages: [[row('gone'), row('ok2')], []],
      verifyThrows: (r) => (r.key === 'gone' ? enoent : undefined),
    });
    await runner.run();
    // No verdict written for the vanished blob.
    expect(nativeUpdate.mock.calls.find((c) => c[1].key === 'gone')).toBeUndefined();
    // But the intact one is still checked and the cursor advanced past both.
    expect(nativeUpdate.mock.calls.find((c) => c[1].key === 'ok2')).toBeDefined();
    expect(state.scanned).toBe(1);
  });

  it('case 5: a corrupt verdict is handed to repair; a repaired outcome bumps the counter', async () => {
    const { runner, state, repair } = build({
      pages: [[row('bad')], []],
      verify: () => ({ ok: false, actualSha256: 'f'.repeat(64), bytesHashed: 5n }),
      repairOutcome: 'repaired',
    });
    await runner.run();
    expect(repair.repair).toHaveBeenCalledTimes(1);
    expect(state.repaired).toBe(1);
  });

  it('case 6: triggerManual() forces one pass even when the scheduled scrub is disabled', async () => {
    const { runner, scanForScrub } = build({ enabled: false, pages: [[row('k1')], []] });
    runner.triggerManual();
    await runner.run();
    expect(scanForScrub).toHaveBeenCalled();
    // The flag is one-shot: a second run without re-triggering is a no-op.
    scanForScrub.mockClear();
    await runner.run();
    expect(scanForScrub).not.toHaveBeenCalled();
  });
});
