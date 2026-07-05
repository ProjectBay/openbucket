---
id: TASK-3634
title: Expose schedule status + "Run now" in the admin API and backup UI
story: STORY-1203
status: backlog
type: implementation
size: M
---

## Description
Surface the scheduled-backup state to the operator: two JWT-guarded admin endpoints
(read status, run-now) on the existing `BackupController`, and last-run / next-run +
a "Run now" button in the Angular `backup-restore.component.ts`. Reuses
`ScheduledBackupService` (TASK-3632) so run-now and the scheduled tick take the same
path and share the in-flight lock.

## Files to create / modify
- `libs/nestjs/src/lib/admin/backup/backup.controller.ts` — modify (add `GET backup/schedule`, `POST backup/schedule/run-now`)
- `libs/nestjs/src/lib/admin/backup/dto/schedule-status.dto.ts` — new (nestjs-zod response DTO)
- `apps/openbucket-frontend/src/app/backup-restore/backup-restore.component.ts` — modify (status card + run-now, signals)
- `apps/openbucket-frontend/src/assets/i18n/*.json` — modify (new `backupRestore.schedule.*` strings)
- `libs/nestjs/src/lib/admin/backup/backup.controller.spec.ts` — new/modify

## Implementation notes
- Controller (JSON endpoints — drop `@ApiExcludeController` for these two, or add a
  second controller, so the typescript-angular api-client can generate them; the
  existing binary stream endpoints stay excluded):

  ```ts
  @Get('backup/schedule')
  scheduleStatus(): Promise<ScheduleStatusDto> { return this.scheduled.getStatus(); }

  @Post('backup/schedule/run-now')
  @HttpCode(202)
  runNow(): Promise<{ started: boolean }> { return this.scheduled.runNowOrJoin(); }
  ```

  Both are already behind the global `AdminModule` JWT guard (the existing backup
  routes are — see `backup.controller.ts` class comment) and the admin-surface rate
  limits; no new authz wiring.
- `getStatus()` reads `state.json` + config and returns:
  `{ enabled, scope, schedule: { cron?, intervalMinutes? }, lastRunAt, nextRunAt, lastStatus, lastError, lastDurationMs, lastBytes, lastObjectCount, keepLast, maxAgeDays, snapshotCount }`.
  `nextRunAt` computed via the same cron/interval logic (TASK-3632). **Redaction**:
  the DTO deliberately omits `dir` (absolute host path), any credentials, and object
  keys — it carries counts / timestamps / policy numbers only, matching the
  counts-only posture of `RequestMetricsService` and the EPIC-08 secret-redaction
  rule. `lastError` is the already-truncated snapshot error string (no paths).
- `runNowOrJoin()` calls `ScheduledBackupService.runSnapshotCycle('manual')` but if a
  cycle is already in flight it **joins** the existing promise and returns
  `{ started: false }` (202) rather than launching a second concurrent snapshot —
  this is the DoS guard so a button-mash / scripted flood can't spawn N concurrent
  snapshots. Consider a soft min-interval (e.g. ignore run-now within 5s of a
  completed manual run) if abuse is a concern; the in-flight join is the hard guard.
- DTO: `createZodDto` over a `.strict()` Zod schema (pattern from
  `admin/buckets/dto/create-bucket.dto.ts`), so the OpenAPI export + api-client pick
  it up.
- Angular (`OnPush`, signals — matches the existing component):
  - add `readonly schedule = signal<ScheduleStatus | null>(null);` loaded in the
    constructor via the generated `BackupAdminService` (or `HttpClient` to
    `/api/admin/backup/schedule`), refreshed after run-now resolves;
  - a status card (reuse `HlmCard`) showing enabled/scope/schedule, last run
    (relative time + ok/error/skipped badge), next run, and snapshot count;
  - a "Run now" `hlmBtn` disabled while `busy()` or when `!schedule()?.enabled`,
    calling the run-now endpoint and using the existing `notify.promise` toast
    pattern; poll `getStatus` once after ~2s (or on toast resolve) to reflect the new
    `lastRunAt`. No secrets/paths are rendered (the DTO doesn't carry them).
- **Edge cases**: scheduling disabled → the card shows an "off" state and hides
  run-now (or shows it disabled with a tooltip); never-run → `lastRunAt` null,
  `nextRunAt` = now (interval) or next cron fire.

## Acceptance criteria
- [ ] `GET /api/admin/backup/schedule` returns the status DTO (JWT-guarded, 401 without a token) and its payload contains no `dir`, credential, or object-key fields.
- [ ] `POST /api/admin/backup/schedule/run-now` triggers exactly one snapshot cycle; a concurrent second call returns `{ started: false }` and does not launch a second cycle.
- [ ] The backup UI shows last-run / next-run + a working "Run now" that refreshes status after completion; `nx lint openbucket-frontend` and `nx build openbucket-frontend` pass.
- [ ] OpenAPI export contains the new `backup/schedule` route; `nx test nestjs --testPathPattern='backup.controller'` passes.

## Test obligations
- Unit: covered by [TEST-1203] (case 7)
- E2E: covered by [TEST-1203] (case 8, run-now + status round-trip)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3632], [TASK-3633]
