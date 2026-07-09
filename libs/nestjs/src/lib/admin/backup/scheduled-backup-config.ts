import { Logger } from '@nestjs/common';
import { isAbsolute, join, resolve } from 'node:path';

import { AppConfigService } from '../../common/config/app-config.service';

/**
 * The single resolved scheduled-backup shape both config sources (standalone env
 * + library `forRoot` options) funnel through — mirrors `ReplicationConfig`. When
 * `enabled` is `false` the runner short-circuits at zero cost. The resolved
 * config is NEVER logged (it carries the absolute snapshot `dir`, a host path);
 * only counts/durations are logged elsewhere (matches `RequestMetricsService`).
 */
export interface ScheduledBackupConfig {
  enabled: boolean;
  /** `instance` = one whole-instance snapshot; `buckets` = one per bucket. */
  scope: 'instance' | 'buckets';
  /** 5-field cron schedule (mutually exclusive with `intervalMinutes`). */
  cron?: string;
  /** Fixed interval between snapshots, minutes (mutually exclusive with `cron`). */
  intervalMinutes?: number;
  /** Absolute snapshot directory; defaults to `<dataDir>/backups`. Boot config
   *  only — NEVER derived from request input. */
  dir: string;
  /** Retention: keep the newest N snapshots (a hard floor). */
  keepLast: number;
  /** Retention: also keep anything younger than this many days (union). */
  maxAgeDays: number;
  /** Fixed wake tick (ms) — how often the runner checks whether a snapshot is due. */
  checkIntervalMs: number;
  /** Push each finished snapshot to the replication target under a reserved prefix. */
  pushToReplication: boolean;
}

/** DI token carrying the fully-resolved {@link ScheduledBackupConfig}. */
export const SCHEDULED_BACKUP_CONFIG = Symbol('SCHEDULED_BACKUP_CONFIG');

/** A disabled config — the runner never fires. */
const DISABLED: Omit<ScheduledBackupConfig, 'dir'> = {
  enabled: false,
  scope: 'instance',
  keepLast: 7,
  maxAgeDays: 30,
  checkIntervalMs: 60_000,
  pushToReplication: false,
};

/**
 * Resolve the scheduled-backup config from `AppConfigService` (both the env and
 * the options source funnel through it). Returns `{ enabled: false, … }` when
 * unset. `dir` is normalised to an absolute path (default `<dataDir>/backups`).
 * Logs a boot-time WARNING when `pushToReplication` is set but replication is
 * off (the flag is then a no-op) — never a hard failure, so an operator can
 * enable replication later. The resolved config is NEVER logged.
 */
export function resolveScheduledBackupConfig(config: AppConfigService): ScheduledBackupConfig {
  const rawDir = config.scheduledBackupDir;
  // Absolute snapshot dir: an operator-supplied path is resolved as-is; the
  // default lives under DATA_DIR. Boot config only — no request input reaches it.
  const dir = rawDir
    ? isAbsolute(rawDir)
      ? rawDir
      : resolve(rawDir)
    : join(config.dataDir, 'backups');

  if (!config.scheduledBackupEnabled) return { ...DISABLED, dir };

  if (config.scheduledBackupPushToReplication && !config.replicationEnabled) {
    new Logger('ScheduledBackupConfig').warn(
      'OPENBUCKET_SCHEDULED_BACKUP_PUSH_TO_REPLICATION=true but replication is disabled — ' +
        'snapshots will be written locally only (the push is a no-op). Enable ' +
        'OPENBUCKET_REPLICATION_* to push snapshots off-box.',
    );
  }

  return {
    enabled: true,
    scope: config.scheduledBackupScope,
    cron: config.scheduledBackupCron,
    intervalMinutes: config.scheduledBackupIntervalMinutes,
    dir,
    keepLast: config.scheduledBackupKeepLast,
    maxAgeDays: config.scheduledBackupMaxAgeDays,
    checkIntervalMs: config.scheduledBackupCheckIntervalMs,
    pushToReplication: config.scheduledBackupPushToReplication,
  };
}
