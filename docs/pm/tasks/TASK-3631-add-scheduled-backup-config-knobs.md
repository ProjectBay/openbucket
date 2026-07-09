---
id: TASK-3631
title: Add scheduled-backup config knobs across env schema + module options
story: STORY-1203
status: backlog
type: implementation
size: M
---

## Description
Add the scheduled-backup configuration to both config sources — the standalone
env schema and the library `forRoot` options — funnelled through
`AppConfigService` and resolved into a single `ScheduledBackupConfig` shape, exactly
as replication does (`resolveReplicationConfig` / `REPLICATION_CONFIG`). This is the
knob surface the runner (TASK-3632) and controller (TASK-3634) read.

## Files to create / modify
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (new `OPENBUCKET_SCHEDULED_BACKUP_*` vars + cross-field refine)
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify (typed accessors)
- `libs/nestjs/src/lib/open-bucket-options.ts` — modify (`backups?` block on `OpenBucketModuleOptions` + `ResolvedOpenBucketOptions`, `resolveOptions`, `validateSecurityCriticalOptions`)
- `libs/nestjs/src/lib/common/config/config-source.ts` — modify (map resolved options → env-shaped config, apply numeric defaults)
- `libs/nestjs/src/lib/admin/backup/scheduled-backup-config.ts` — new (`ScheduledBackupConfig` + `SCHEDULED_BACKUP_CONFIG` token + `resolveScheduledBackupConfig`)
- `libs/nestjs/package.json`, `apps/openbucket-backend/package.json`, root `package.json` — modify (add `cron-parser`)

## Implementation notes
- Env vars (mirror the `OPENBUCKET_REPLICATION_*` block, `z.coerce.number().int().min().max().default()`):
  - `OPENBUCKET_SCHEDULED_BACKUP_ENABLED` — `envBoolean(false)`
  - `OPENBUCKET_SCHEDULED_BACKUP_SCOPE` — `z.enum(['instance','buckets']).default('instance')` (`buckets` = one snapshot per bucket)
  - `OPENBUCKET_SCHEDULED_BACKUP_INTERVAL_MINUTES` — `z.coerce.number().int().min(5).max(43200).optional()`
  - `OPENBUCKET_SCHEDULED_BACKUP_CRON` — `z.string().optional()` (5-field cron; validated below)
  - `OPENBUCKET_SCHEDULED_BACKUP_DIR` — `z.string().optional()` (default `<DATA_DIR>/backups` applied at resolve time)
  - `OPENBUCKET_SCHEDULED_BACKUP_KEEP_LAST` — `z.coerce.number().int().min(1).max(1000).default(7)`
  - `OPENBUCKET_SCHEDULED_BACKUP_MAX_AGE_DAYS` — `z.coerce.number().int().min(1).max(3650).default(30)`
  - `OPENBUCKET_SCHEDULED_BACKUP_CHECK_INTERVAL_MS` — `z.coerce.number().int().min(10_000).max(3_600_000).default(60_000)` (the fixed wake tick)
  - `OPENBUCKET_SCHEDULED_BACKUP_PUSH_TO_REPLICATION` — `envBoolean(false)`
- Cross-field `superRefine` when `OPENBUCKET_SCHEDULED_BACKUP_ENABLED`:
  - exactly one of `INTERVAL_MINUTES` / `CRON` must be set (mutually exclusive; error otherwise);
  - if `CRON` is set, parse it with `cron-parser` (`CronExpressionParser.parse(cron)` in a try/catch) and add a Zod issue on failure — **fail fast at boot**, never mid-tick;
  - if `PUSH_TO_REPLICATION` is true but `OPENBUCKET_REPLICATION_ENABLED` is false, do **not** hard-fail — log a boot WARNING (the flag is a no-op) so an operator toggling replication later isn't blocked.
- `ScheduledBackupConfig` (resolved shape both sources funnel through), plus a
  `DISABLED` const like `replication-config.ts`:

  ```ts
  export interface ScheduledBackupConfig {
    enabled: boolean;
    scope: 'instance' | 'buckets';
    cron?: string;
    intervalMinutes?: number;
    dir: string;                 // absolute; default <dataDir>/backups
    keepLast: number;
    maxAgeDays: number;
    checkIntervalMs: number;
    pushToReplication: boolean;
  }
  export const SCHEDULED_BACKUP_CONFIG = Symbol('SCHEDULED_BACKUP_CONFIG');
  export function resolveScheduledBackupConfig(config: AppConfigService): ScheduledBackupConfig
  ```

- `open-bucket-options.ts`: add an optional `backups?` block to
  `OpenBucketModuleOptions` / `ResolvedOpenBucketOptions` (`scope`, `cron`,
  `intervalMinutes`, `dir`, `keepLast`, `maxAgeDays`, `pushToReplication`), pass it
  through in `resolveOptions` (like `webhooks` / `replication` — pass-through,
  defaults applied in `config-source.ts`). In `validateSecurityCriticalOptions` add
  a `backups` Zod branch that runs the same cron `superRefine` so an embedder gets
  the identical fail-fast guarantee.
- **3-place native-dep externalization** for `cron-parser` (pure-JS but must stay
  out of the webpack bundle): add it to (1) `libs/nestjs/package.json` `dependencies`,
  (2) `apps/openbucket-backend/package.json` `dependencies` so `webpack.config.js`'s
  `externalDependencies` (derived from that package.json, see line ~11–12) keeps it
  external and it resolves from `node_modules` at runtime, and (3) the root
  workspace `package.json` for the install graph. `import { CronExpressionParser } from 'cron-parser'`.
- **Security/DoS**: the resolved config is NEVER logged (mirrors
  `resolveReplicationConfig`'s comment). `dir` is normalised to an absolute path; if
  an operator points it inside `DATA_DIR` that is fine, but it must not be derived
  from any request input — it is boot config only. `checkIntervalMs` has a `min` so a
  hostile-tiny value can't busy-loop the scheduler.

## Acceptance criteria
- [ ] `OPENBUCKET_SCHEDULED_BACKUP_*` vars parse with defaults; enabling with neither/both of interval+cron fails boot with a clear message.
- [ ] A malformed `OPENBUCKET_SCHEDULED_BACKUP_CRON` fails `env.schema` parsing (and `validateSecurityCriticalOptions` for the library path).
- [ ] `resolveScheduledBackupConfig` returns `{ enabled: false, … }` when unset and a fully-defaulted shape when enabled; `dir` defaults to `<dataDir>/backups`.
- [ ] `cron-parser` appears in all three package.json files and is `external` in the backend webpack bundle (`nx build openbucket-backend` succeeds, bundle does not inline it).
- [ ] `nx test nestjs --testPathPattern='env.schema|open-bucket-options'` passes with the new cases.

## Test obligations
- Unit: covered by [TEST-1203] (cases 2, 9)
- E2E: N/A — pure config
- Conformance: N/A

## Dependencies
- Blocked by: —
