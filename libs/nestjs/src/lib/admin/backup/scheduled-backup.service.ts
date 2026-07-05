import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { v7 as uuidv7 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';

import { BucketRepository } from '../../persistence/repositories/bucket.repository';
import { AppConfigService } from '../../common/config/app-config.service';
import { Clock } from '../../common/clock/clock';
import { ReplicationTargetService } from '../../storage/replication/replication-target.service';
import { BackupService } from './backup.service';
import {
  SCHEDULED_BACKUP_CONFIG,
  type ScheduledBackupConfig,
} from './scheduled-backup-config';

const MS_PER_DAY = 86_400_000;
const PRUNE_BATCH = 200;
const LAST_ERROR_MAX = 500;
/** Reserved remote prefix for pushed snapshots — kept clear of replication's
 *  raw-key objects and tiering's `_ob_tiered/` blobs (STORY-1203). */
export const BACKUP_PREFIX = '_ob_backups/';

/** Persisted run state (`<dir>/state.json`) — the filesystem is the source of
 *  truth (no DB table / migration), so the feature stays embeddable. `nextRunAt`
 *  is computed on read, never stored, so a schedule change takes effect at once. */
export interface ScheduledBackupState {
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs: number;
  lastBytes: number;
  lastObjectCount: number;
  lastSnapshotCount: number;
}

const INITIAL_STATE: ScheduledBackupState = {
  lastRunAt: null,
  lastStatus: 'ok',
  lastDurationMs: 0,
  lastBytes: 0,
  lastObjectCount: 0,
  lastSnapshotCount: 0,
};

/** Sidecar written next to each snapshot `.zip` (`<name>.json`). */
interface SnapshotSidecar {
  createdAt: string;
  scope: 'instance' | 'buckets';
  bucket?: string;
  bytes: number;
  objectCount: number;
  sha256: string;
}

/** Read-only view returned to the admin status endpoint (TASK-3634). Carries
 *  counts / timestamps / policy numbers only — NEVER `dir`, credentials, or keys. */
export interface ScheduleStatus {
  enabled: boolean;
  scope: 'instance' | 'buckets';
  schedule: { cron?: string; intervalMinutes?: number };
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: 'ok' | 'error' | 'skipped';
  lastError: string | null;
  lastDurationMs: number;
  lastBytes: number;
  lastObjectCount: number;
  keepLast: number;
  maxAgeDays: number;
  snapshotCount: number;
}

/**
 * Owns the real scheduled-backup work (STORY-1203) so the background runner
 * (TASK-3632) and the admin run-now (TASK-3634) share one path — including the
 * in-flight lock, so a scheduled tick and a run-now can never overlap. Reuses
 * `BackupService.writeSnapshot` (the vetted read path) into a file sink, persists
 * run state on the filesystem (like `TrashPurgeRunner`), prunes by retention, and
 * optionally pushes each snapshot to the replication target.
 *
 * Security/DoS: snapshots hold decrypted plaintext object bytes (same as the
 * download / replication) — files are `0o600` under a `0o700` dir, and the backup
 * volume inherits the data volume's trust boundary. A free-space pre-flight +
 * retention bound disk growth. Nothing derived from a request reaches these fs
 * paths (`dir` is boot config; bucket names come from the repo). Only counts /
 * durations are logged — never `dir` contents, credentials, or object keys.
 */
@Injectable()
export class ScheduledBackupService {
  private readonly log = new Logger(ScheduledBackupService.name);
  /** Guards `runSnapshotCycle` so the tick + run-now never run concurrently. */
  private inFlight?: Promise<void>;

  constructor(
    @Inject(SCHEDULED_BACKUP_CONFIG) private readonly config: ScheduledBackupConfig,
    private readonly backup: BackupService,
    private readonly bucketRepo: BucketRepository,
    private readonly appConfig: AppConfigService,
    private readonly clock: Clock,
    @Optional() private readonly replication?: ReplicationTargetService,
  ) {}

  // ===== schedule math ==================================================

  /** Next fire time (ms) given the last run. Interval: `lastRun + interval` (or
   *  now if never run → due immediately). Cron: the next fire after the last run
   *  (or after now if never run). */
  private nextRunAtMs(lastRunAtMs: number | null, nowMs: number): number {
    if (this.config.intervalMinutes != null) {
      if (lastRunAtMs == null) return nowMs;
      return lastRunAtMs + this.config.intervalMinutes * 60_000;
    }
    const base = lastRunAtMs != null ? new Date(lastRunAtMs) : new Date(nowMs);
    return CronExpressionParser.parse(this.config.cron as string, { currentDate: base })
      .next()
      .getTime();
  }

  /** True when a snapshot is due at `nowMs` per the schedule + persisted last-run. */
  async isDue(nowMs: number): Promise<boolean> {
    if (!this.config.enabled) return false;
    const state = await this.readState();
    const lastRunAtMs = state.lastRunAt ? Date.parse(state.lastRunAt) : null;
    return nowMs >= this.nextRunAtMs(lastRunAtMs, nowMs);
  }

  // ===== the snapshot cycle (shared by tick + run-now) ==================

  /** Run one snapshot cycle, joining an in-flight cycle instead of starting a
   *  second (the tick can't pile up on itself; run-now is the other caller). */
  runSnapshotCycle(trigger: 'scheduled' | 'manual'): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRunCycle(trigger).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Kick off a manual cycle, or JOIN an in-flight one (returns `started:false`).
   *  The in-flight join is the hard DoS guard so a button-mash / scripted flood
   *  can't spawn N concurrent snapshots. */
  runNowOrJoin(): { started: boolean } {
    if (this.inFlight) return { started: false };
    // Fire-and-forget: `doRunCycle` never rejects (it records state on error), so
    // the un-awaited promise can't surface an unhandled rejection.
    void this.runSnapshotCycle('manual');
    return { started: true };
  }

  private async doRunCycle(trigger: 'scheduled' | 'manual'): Promise<void> {
    const startedMs = this.clock.nowMs();
    const scopeDir = join(this.config.dir, this.config.scope);

    // Pre-flight free-space guard: don't fill the disk / self-DoS. A shortfall
    // skips the whole cycle with a WARNING and leaves no partial file.
    const reserve = this.appConfig.dataDirMinFreeBytes;
    if (reserve > 0) {
      const avail = await this.availableBytes(this.config.dir).catch(() => Number.POSITIVE_INFINITY);
      if (avail < reserve) {
        this.log.warn(
          `scheduled-backup: skipping ${trigger} cycle — free space ${avail}B below reserve ${reserve}B`,
        );
        await this.writeState({
          ...INITIAL_STATE,
          ...(await this.readState()),
          lastRunAt: new Date(startedMs).toISOString(),
          lastStatus: 'skipped',
          lastError: undefined,
          lastDurationMs: this.clock.nowMs() - startedMs,
        });
        return;
      }
    }

    await fs.mkdir(scopeDir, { recursive: true, mode: 0o700 });

    let successCount = 0;
    let errorCount = 0;
    let totalBytes = 0;
    let totalObjects = 0;
    let lastError: string | undefined;
    const writtenZips: Array<{ zipPath: string; meta: SnapshotSidecar }> = [];

    if (this.config.scope === 'instance') {
      const names = (await this.bucketRepo.listAll()).map((b) => b.name);
      try {
        const written = await this.writeOneSnapshot(scopeDir, 'instance', names);
        writtenZips.push(written);
        successCount++;
        totalBytes += written.meta.bytes;
        totalObjects += written.meta.objectCount;
      } catch (err) {
        errorCount++;
        lastError = ((err as Error)?.message ?? String(err)).slice(0, LAST_ERROR_MAX);
        this.log.error(`scheduled-backup: instance snapshot failed: ${lastError}`);
      }
    } else {
      // Per-bucket isolation: a throw on one bucket is logged and does not abort
      // the others (mirrors TrashPurgeRunner's per-entry try/catch).
      const buckets = await this.bucketRepo.listAll();
      for (const b of buckets) {
        try {
          const written = await this.writeOneSnapshot(scopeDir, 'bucket', [b.name], b.name);
          writtenZips.push(written);
          successCount++;
          totalBytes += written.meta.bytes;
          totalObjects += written.meta.objectCount;
        } catch (err) {
          errorCount++;
          lastError = ((err as Error)?.message ?? String(err)).slice(0, LAST_ERROR_MAX);
          this.log.error(`scheduled-backup: bucket '${b.name}' snapshot failed: ${lastError}`);
        }
      }
    }

    // Post-cycle housekeeping (best-effort — never flips a successful cycle to
    // error): prune old snapshots, then push the fresh ones if configured.
    let pushError: string | undefined;
    try {
      await this.pruneRetention(scopeDir);
    } catch (err) {
      this.log.error(`scheduled-backup: retention prune failed: ${(err as Error).message}`);
    }
    for (const w of writtenZips) {
      const e = await this.pushSnapshot(w.zipPath, w.meta);
      if (e) pushError = e;
    }

    // status: 'ok' unless every attempted snapshot failed. A push failure is
    // non-fatal (the local snapshot is the system of record) and only annotates.
    const status: ScheduledBackupState['lastStatus'] =
      errorCount > 0 && successCount === 0 ? 'error' : 'ok';
    await this.writeState({
      lastRunAt: new Date(startedMs).toISOString(),
      lastStatus: status,
      lastError: status === 'error' ? lastError : pushError,
      lastDurationMs: this.clock.nowMs() - startedMs,
      lastBytes: totalBytes,
      lastObjectCount: totalObjects,
      lastSnapshotCount: successCount,
    });
    this.log.log(
      `scheduled-backup: ${trigger} cycle wrote ${successCount} snapshot(s) ` +
        `(${totalObjects} object(s), ${totalBytes}B) in ${this.clock.nowMs() - startedMs}ms` +
        (errorCount > 0 ? `, ${errorCount} failed` : ''),
    );
  }

  /** Write one snapshot atomically: stream `writeSnapshot` through a sha256 hash
   *  into `<final>.part`, fsync, then `rename` to the final `.zip` (a crash leaves
   *  only a `.part`, swept next cycle — never a torn `.zip` seen as good), and
   *  write the `<name>.json` sidecar. */
  private async writeOneSnapshot(
    scopeDir: string,
    kind: 'bucket' | 'instance',
    names: string[],
    bucket?: string,
  ): Promise<{ zipPath: string; meta: SnapshotSidecar }> {
    const createdAt = new Date(this.clock.nowMs()).toISOString();
    // `<ISO-compact>-<uuidv7>.zip` — lexical sort == time sort, and uuidv7 stops
    // two snapshots in the same second from colliding.
    const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const zipPath = join(scopeDir, `${stamp}-${uuidv7()}.zip`);
    const tmp = `${zipPath}.part`;

    const hash = createHash('sha256');
    const through = new PassThrough();
    through.on('data', (c: Buffer) => hash.update(c));
    const ws = createWriteStream(tmp, { mode: 0o600 });
    const piped = pipeline(through, ws);

    let bytes: number;
    let objectCount: number;
    try {
      ({ bytes, objectCount } = await this.backup.writeSnapshot(through, kind, names));
      await piped;
    } catch (err) {
      // A failed snapshot must not leave a `.part` masquerading as work; remove it.
      through.destroy();
      ws.destroy();
      // Swallow the aborted pipeline's "Premature close" so it can't surface as an
      // unhandled rejection — the real error is rethrown below.
      await piped.catch(() => undefined);
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }

    // fsync the completed file before the atomic rename.
    const fh = await fs.open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const sha256 = hash.digest('hex');
    await fs.rename(tmp, zipPath);

    const meta: SnapshotSidecar = {
      createdAt,
      scope: this.config.scope,
      bucket,
      bytes,
      objectCount,
      sha256,
    };
    await this.writeJsonAtomic(this.sidecarPath(zipPath), meta);
    return { zipPath, meta };
  }

  // ===== retention (TASK-3633) ==========================================

  /**
   * Prune prior snapshots by union retention:
   *   retain = (rank < keepLast) OR (ageDays < maxAgeDays)
   * so keep-last-N is a hard floor (old-but-within-N kept) and max-age can't
   * delete a fresh snapshot. For `scope: 'buckets'` retention is per bucket. Also
   * sweeps orphan `*.part` crash debris older than one cycle. Per-file failures
   * are logged, never abort the sweep; deletes yield between batches.
   */
  async pruneRetention(scopeDir: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(scopeDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    const nowMs = this.clock.nowMs();

    // Orphan `.part` sweep — crash debris older than one wake tick.
    const partGrace = this.config.checkIntervalMs;
    for (const n of names.filter((f) => f.endsWith('.part'))) {
      const p = join(scopeDir, n);
      try {
        const st = await fs.stat(p);
        if (nowMs - st.mtimeMs > partGrace) await fs.rm(p, { force: true });
      } catch (err) {
        this.log.warn(`scheduled-backup: could not sweep orphan ${n}: ${(err as Error).message}`);
      }
    }

    // Load each `.zip` + its sidecar (createdAt / bucket), grouped for retention.
    interface Entry { zipPath: string; createdAtMs: number; group: string }
    const entries: Entry[] = [];
    for (const n of names.filter((f) => f.endsWith('.zip'))) {
      const zipPath = join(scopeDir, n);
      const sidecar = await this.readSidecar(zipPath);
      const createdAtMs = sidecar?.createdAt
        ? Date.parse(sidecar.createdAt)
        : this.timestampFromName(n);
      // Per-bucket grouping for `buckets` scope; a single group otherwise.
      const group = this.config.scope === 'buckets' ? sidecar?.bucket ?? n : 'instance';
      entries.push({ zipPath, createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0, group });
    }

    const byGroup = new Map<string, Entry[]>();
    for (const e of entries) {
      const g = byGroup.get(e.group) ?? [];
      g.push(e);
      byGroup.set(e.group, g);
    }

    const toDelete: string[] = [];
    for (const group of byGroup.values()) {
      group.sort((a, b) => b.createdAtMs - a.createdAtMs); // newest first
      group.forEach((e, rank) => {
        const ageDays = (nowMs - e.createdAtMs) / MS_PER_DAY;
        const retain = rank < this.config.keepLast || ageDays < this.config.maxAgeDays;
        if (!retain) toDelete.push(e.zipPath);
      });
    }

    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += PRUNE_BATCH) {
      for (const zipPath of toDelete.slice(i, i + PRUNE_BATCH)) {
        try {
          await fs.rm(zipPath, { force: true });
          await fs.rm(this.sidecarPath(zipPath), { force: true });
          deleted++;
        } catch (err) {
          this.log.warn(`scheduled-backup: could not prune ${basename(zipPath)}: ${(err as Error).message}`);
        }
      }
      await new Promise((r) => setImmediate(r));
    }
    if (deleted > 0) {
      this.log.log(`scheduled-backup: pruned ${deleted} old snapshot(s)`);
    }
  }

  // ===== replication push (TASK-3633) ===================================

  /**
   * Push a finished snapshot to the replication target under {@link BACKUP_PREFIX}
   * (kept clear of replication raw-key objects + `_ob_tiered/` blobs). Only when
   * `pushToReplication` AND replication is enabled. `putObject` streams via
   * lib-storage multipart above the threshold, so a multi-GB snapshot never
   * buffers. Push failure is NON-fatal: the local snapshot is the system of
   * record — the error is logged (truncated) and returned as a `pushError` note,
   * never rethrown. Returns the error string on failure, else `undefined`.
   */
  private async pushSnapshot(zipPath: string, meta: SnapshotSidecar): Promise<string | undefined> {
    if (!this.config.pushToReplication || !this.replication?.enabled) return undefined;
    const key = `${BACKUP_PREFIX}${meta.scope}/${basename(zipPath)}`;
    const body = createReadStream(zipPath);
    try {
      await this.replication.putObject({
        key,
        body,
        contentLength: meta.bytes,
        contentType: 'application/zip',
      });
      return undefined;
    } catch (err) {
      body.destroy(); // tear down the fd on failure (mirrors ReplicationWorkerRunner.send)
      const msg = ((err as Error)?.message ?? String(err)).slice(0, LAST_ERROR_MAX);
      this.log.warn(`scheduled-backup: push of ${basename(zipPath)} failed (non-fatal): ${msg}`);
      return `push failed: ${msg}`;
    }
  }

  // ===== status (TASK-3634) =============================================

  /** The redacted status view for the admin endpoint. Computes `nextRunAt` from
   *  the same schedule math; omits `dir`, credentials, and object keys. */
  async getStatus(): Promise<ScheduleStatus> {
    const state = await this.readState();
    const nowMs = this.clock.nowMs();
    const lastRunAtMs = state.lastRunAt ? Date.parse(state.lastRunAt) : null;
    const nextRunAt = this.config.enabled
      ? new Date(this.nextRunAtMs(lastRunAtMs, nowMs)).toISOString()
      : null;
    return {
      enabled: this.config.enabled,
      scope: this.config.scope,
      schedule: { cron: this.config.cron, intervalMinutes: this.config.intervalMinutes },
      lastRunAt: state.lastRunAt,
      nextRunAt,
      lastStatus: state.lastStatus,
      lastError: state.lastError ?? null,
      lastDurationMs: state.lastDurationMs,
      lastBytes: state.lastBytes,
      lastObjectCount: state.lastObjectCount,
      keepLast: this.config.keepLast,
      maxAgeDays: this.config.maxAgeDays,
      snapshotCount: await this.countSnapshots(),
    };
  }

  private async countSnapshots(): Promise<number> {
    try {
      const names = await fs.readdir(join(this.config.dir, this.config.scope));
      return names.filter((n) => n.endsWith('.zip')).length;
    } catch {
      return 0;
    }
  }

  // ===== fs helpers =====================================================

  private sidecarPath(zipPath: string): string {
    return zipPath.replace(/\.zip$/, '.json');
  }

  /** Parse the leading `YYYYMMDDTHHMMSSZ` timestamp from a snapshot filename. */
  private timestampFromName(name: string): number {
    const m = /^(\d{8})T(\d{6})Z/.exec(name);
    if (!m) return NaN;
    const [, d, t] = m;
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
    return Date.parse(iso);
  }

  private async readSidecar(zipPath: string): Promise<SnapshotSidecar | null> {
    try {
      return JSON.parse(await fs.readFile(this.sidecarPath(zipPath), 'utf8')) as SnapshotSidecar;
    } catch {
      return null;
    }
  }

  private statePath(): string {
    return join(this.config.dir, 'state.json');
  }

  private async readState(): Promise<ScheduledBackupState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath(), 'utf8')) as ScheduledBackupState;
      return { ...INITIAL_STATE, ...parsed };
    } catch {
      return { ...INITIAL_STATE };
    }
  }

  private async writeState(state: ScheduledBackupState): Promise<void> {
    await fs.mkdir(this.config.dir, { recursive: true, mode: 0o700 });
    await this.writeJsonAtomic(this.statePath(), state);
  }

  /** Atomic JSON write: `.part` → rename, so a crash never leaves a torn file. */
  private async writeJsonAtomic(path: string, obj: unknown): Promise<void> {
    const tmp = `${path}.part`;
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
    await fs.rename(tmp, path);
  }

  /** Available bytes on the snapshot volume. Split out as a seam for testing. */
  protected async availableBytes(dir: string): Promise<number> {
    const st = await statfs(dir);
    return st.bavail * st.bsize;
  }
}
