import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';

import type { BackupService } from './backup.service';
import type { BucketRepository } from '../../persistence/repositories/bucket.repository';
import type { AppConfigService } from '../../common/config/app-config.service';
import type { ReplicationTargetService } from '../../storage/replication/replication-target.service';
import { TestClock } from '../../common/clock/clock';
import { ScheduledBackupService } from './scheduled-backup.service';
import type { ScheduledBackupConfig } from './scheduled-backup-config';

/**
 * TEST-1203 (cases 3–7) — the scheduled-backup orchestration (TASK-3632/3633):
 * atomic snapshot write + fs-persisted run state, per-bucket failure isolation,
 * free-space skip, union retention, and the optional replication push.
 */
describe('ScheduledBackupService', () => {
  let dir: string;
  let clock: TestClock;

  const baseConfig = (over: Partial<ScheduledBackupConfig> = {}): ScheduledBackupConfig => ({
    enabled: true,
    scope: 'instance',
    intervalMinutes: 60,
    dir,
    keepLast: 7,
    maxAgeDays: 30,
    checkIntervalMs: 60_000,
    pushToReplication: false,
    ...over,
  });

  /** BackupService.writeSnapshot mock: writes deterministic bytes to the sink,
   *  optionally throwing for a named bucket to exercise per-bucket isolation. */
  const makeBackup = (throwFor?: string): BackupService =>
    ({
      writeSnapshot: jest.fn(async (sink: Writable, _kind: string, names: string[]) => {
        if (throwFor && names.includes(throwFor)) throw new Error('boom');
        await new Promise<void>((resolve, reject) => {
          sink.write(Buffer.from('zipdata'), (e) => (e ? reject(e) : resolve()));
        });
        sink.end();
        return { bytes: 7, objectCount: names.length };
      }),
    }) as unknown as BackupService;

  const makeBucketRepo = (names: string[]): BucketRepository =>
    ({ listAll: jest.fn().mockResolvedValue(names.map((name) => ({ name }))) }) as unknown as BucketRepository;

  const appConfig = { dataDirMinFreeBytes: 100 } as unknown as AppConfigService;

  function makeService(
    config: ScheduledBackupConfig,
    backup: BackupService,
    bucketRepo: BucketRepository,
    replication?: ReplicationTargetService,
    availableBytes = 1e12,
  ): ScheduledBackupService {
    const svc = new ScheduledBackupService(config, backup, bucketRepo, appConfig, clock, replication);
    jest.spyOn(svc as unknown as { availableBytes: () => Promise<number> }, 'availableBytes')
      .mockResolvedValue(availableBytes);
    return svc;
  }

  const listZips = async (scope: string): Promise<string[]> => {
    try {
      return (await fs.readdir(join(dir, scope))).filter((n) => n.endsWith('.zip')).sort();
    } catch {
      return [];
    }
  };

  beforeEach(async () => {
    dir = join(process.cwd(), 'tmp', 'openbucket-sched-test', randomUUID());
    await fs.mkdir(dir, { recursive: true });
    clock = new TestClock();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('case 3: writes a snapshot + sidecar atomically and records ok run state', async () => {
    const svc = makeService(baseConfig(), makeBackup(), makeBucketRepo(['b1']));
    await svc.runSnapshotCycle('scheduled');

    const zips = await listZips('instance');
    expect(zips).toHaveLength(1);
    // sidecar present, no `.part` left behind.
    const files = await fs.readdir(join(dir, 'instance'));
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1);
    expect(files.filter((f) => f.endsWith('.part'))).toHaveLength(0);

    const state = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8'));
    expect(state.lastStatus).toBe('ok');
    expect(state.lastRunAt).not.toBeNull();
    expect(state.lastSnapshotCount).toBe(1);
    expect(state.lastBytes).toBe(7);
  });

  it('case 4: interval isDue — due when never run, not due until the interval elapses', async () => {
    const svc = makeService(baseConfig({ intervalMinutes: 60 }), makeBackup(), makeBucketRepo(['b1']));
    expect(await svc.isDue(clock.nowMs())).toBe(true); // never run
    await svc.runSnapshotCycle('scheduled');
    expect(await svc.isDue(clock.nowMs())).toBe(false); // just ran
    clock.advance(60 * 60_000);
    expect(await svc.isDue(clock.nowMs())).toBe(true); // interval elapsed
  });

  it('case 5: scope=buckets writes one per bucket; one failure does not stop the others', async () => {
    const svc = makeService(
      baseConfig({ scope: 'buckets' }),
      makeBackup('bad'),
      makeBucketRepo(['good', 'bad', 'other']),
    );
    await svc.runSnapshotCycle('scheduled');
    const zips = await listZips('buckets');
    expect(zips).toHaveLength(2); // good + other; bad failed
    const state = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8'));
    expect(state.lastStatus).toBe('ok'); // some succeeded
    expect(state.lastSnapshotCount).toBe(2);
  });

  it('case 5b: a free-space shortfall skips the cycle with no partial file', async () => {
    const svc = makeService(baseConfig(), makeBackup(), makeBucketRepo(['b1']), undefined, 50); // < reserve 100
    await svc.runSnapshotCycle('scheduled');
    expect(await listZips('instance')).toHaveLength(0);
    const state = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8'));
    expect(state.lastStatus).toBe('skipped');
  });

  it('case 6: union retention keeps the newest keepLast OR anything within maxAgeDays', async () => {
    const scopeDir = join(dir, 'instance');
    await fs.mkdir(scopeDir, { recursive: true });
    const nowMs = clock.nowMs();
    const DAY = 86_400_000;
    // ranks by recency: 0.5d, 0.6d, 2d, 3d old.
    const ages = [0.5, 0.6, 2, 3];
    for (let i = 0; i < ages.length; i++) {
      const createdAt = new Date(nowMs - ages[i] * DAY).toISOString();
      const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const zip = join(scopeDir, `${stamp}-${randomUUID()}.zip`);
      await fs.writeFile(zip, 'x');
      await fs.writeFile(zip.replace(/\.zip$/, '.json'), JSON.stringify({ createdAt, scope: 'instance', bytes: 1, objectCount: 0, sha256: '' }));
    }
    // keepLast=2, maxAgeDays=1 → keep ranks 0,1 (and they're also <1d); delete 2d/3d.
    const svc = makeService(baseConfig({ keepLast: 2, maxAgeDays: 1 }), makeBackup(), makeBucketRepo([]));
    await svc.pruneRetention(scopeDir);
    expect(await listZips('instance')).toHaveLength(2);
    // every surviving .zip still has its sidecar.
    const files = await fs.readdir(scopeDir);
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(2);
  });

  it('case 6b: keepLast is a hard floor — an old snapshot within the newest N is retained', async () => {
    const scopeDir = join(dir, 'instance');
    await fs.mkdir(scopeDir, { recursive: true });
    const nowMs = clock.nowMs();
    const DAY = 86_400_000;
    for (const ageDays of [1, 100]) {
      const createdAt = new Date(nowMs - ageDays * DAY).toISOString();
      const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const zip = join(scopeDir, `${stamp}-${randomUUID()}.zip`);
      await fs.writeFile(zip, 'x');
      await fs.writeFile(zip.replace(/\.zip$/, '.json'), JSON.stringify({ createdAt, scope: 'instance', bytes: 1, objectCount: 0, sha256: '' }));
    }
    // keepLast=2, maxAgeDays=5: the 100d-old snapshot fails max-age but is within
    // the newest 2, so the keep-last floor retains it.
    const svc = makeService(baseConfig({ keepLast: 2, maxAgeDays: 5 }), makeBackup(), makeBucketRepo([]));
    await svc.pruneRetention(scopeDir);
    expect(await listZips('instance')).toHaveLength(2);
  });

  it('case 6c: orphan .part crash debris older than one cycle is swept', async () => {
    const scopeDir = join(dir, 'instance');
    await fs.mkdir(scopeDir, { recursive: true });
    const part = join(scopeDir, 'stale.zip.part');
    await fs.writeFile(part, 'debris');
    // backdate its mtime beyond one checkInterval (60s).
    const old = new Date(clock.nowMs() - 120_000);
    await fs.utimes(part, old, old);
    const svc = makeService(baseConfig(), makeBackup(), makeBucketRepo([]));
    await svc.pruneRetention(scopeDir);
    await expect(fs.access(part)).rejects.toBeDefined();
  });

  it('case 7: pushToReplication uploads under _ob_backups/ when replication is enabled', async () => {
    const putObject = jest.fn().mockResolvedValue(undefined);
    const replication = { enabled: true, putObject } as unknown as ReplicationTargetService;
    const svc = makeService(baseConfig({ pushToReplication: true }), makeBackup(), makeBucketRepo(['b1']), replication);
    await svc.runSnapshotCycle('scheduled');
    expect(putObject).toHaveBeenCalledTimes(1);
    const arg = putObject.mock.calls[0][0];
    expect(arg.key).toMatch(/^_ob_backups\/instance\/.+\.zip$/);
    expect(arg.contentType).toBe('application/zip');
    const state = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8'));
    expect(state.lastStatus).toBe('ok');
  });

  it('case 7b: a push failure leaves the local snapshot intact and the cycle ok', async () => {
    const putObject = jest.fn().mockRejectedValue(new Error('remote down'));
    const replication = { enabled: true, putObject } as unknown as ReplicationTargetService;
    const svc = makeService(baseConfig({ pushToReplication: true }), makeBackup(), makeBucketRepo(['b1']), replication);
    await svc.runSnapshotCycle('scheduled');
    expect(await listZips('instance')).toHaveLength(1);
    const state = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8'));
    expect(state.lastStatus).toBe('ok');
    expect(state.lastError).toMatch(/push failed/);
  });

  it('run-now joins an in-flight cycle rather than launching a second', async () => {
    const backup = makeBackup();
    const svc = makeService(baseConfig(), backup, makeBucketRepo(['b1']));
    const first = svc.runNowOrJoin();
    const second = svc.runNowOrJoin();
    expect(first).toEqual({ started: true });
    expect(second).toEqual({ started: false });
    // Deterministically JOIN the same in-flight cycle rather than sleeping a
    // fixed wall-clock 50ms: runSnapshotCycle returns the live `inFlight` promise
    // (never starts a second), so awaiting it waits for the fire-and-forget cycle
    // to fully finish writing. The old setTimeout(50) let the cycle outlive the
    // wait under CPU load, so afterEach's `fs.rm(dir)` raced the still-writing
    // cycle and intermittently threw ENOTEMPTY (rmdir on a non-empty dir).
    await svc.runSnapshotCycle('manual');
    expect((backup.writeSnapshot as jest.Mock).mock.calls.length).toBe(1);
  });

  it('getStatus is redacted (no dir/credentials/keys) and computes nextRunAt', async () => {
    const svc = makeService(baseConfig({ intervalMinutes: 60 }), makeBackup(), makeBucketRepo(['b1']));
    const status = await svc.getStatus();
    expect(Object.keys(status)).not.toContain('dir');
    expect(JSON.stringify(status)).not.toContain(dir);
    expect(status.enabled).toBe(true);
    expect(status.nextRunAt).not.toBeNull(); // never-run interval → due now
    expect(status.keepLast).toBe(7);
  });
});
