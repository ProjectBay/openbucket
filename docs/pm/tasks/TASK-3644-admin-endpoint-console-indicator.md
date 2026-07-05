---
id: TASK-3644
title: Add the admin integrity endpoint, console indicator, and optional Prometheus gauge
story: STORY-1204
status: backlog
type: implementation
size: M
---

## Description
Surface scrub results: a guarded admin API (status summary + paged corrupt list + a manual
"scrub now" trigger), an Angular signals store + a small console indicator badge showing the
corrupt count, and an optional Prometheus gauge for `/metrics`. All read-only routes return
counts and object identities only — never a remote endpoint or credential.

## Files to create / modify
- `libs/nestjs/src/lib/admin/integrity/integrity-admin.controller.ts` — new
- `libs/nestjs/src/lib/admin/integrity/integrity-admin.module.ts` — new
- `libs/nestjs/src/lib/admin/integrity/dto/integrity-status.dto.ts` — new (nestjs-zod)
- `libs/nestjs/src/lib/admin/integrity/dto/corrupt-object.dto.ts` — new (nestjs-zod)
- `libs/nestjs/src/lib/domain/integrity/integrity-status.service.ts` — new (read model over `scrub_state` + `listCorrupt`)
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify (add to `ADMIN_CHILDREN`)
- `apps/openbucket-frontend/src/app/integrity/integrity.signal-store.ts` — new
- `apps/openbucket-frontend/src/app/integrity/integrity.component.ts` — new (Settings tab)
- `apps/openbucket-frontend/src/app/settings/settings.component.ts` — modify (add "Integrity" tab)
- `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts` — modify (badge slot)
- (optional gauge) `libs/nestjs/src/lib/common/metrics/*`, `package.json`, `apps/openbucket-backend/package.json`, `libs/nestjs/package.json`

## Implementation notes
- Controller (model on `replication-admin.controller.ts`: `@Controller('api/admin/integrity')`,
  under the global `JwtAuthGuard`, `default` 100/min throttler, NOT `@ApiExcludeController`):
  ```ts
  @Get('status')  getStatus(): Promise<IntegrityStatusDto>   // { enabled, scanned, ok, corrupt,
                                                              //   unchecked, repaired, lastRunAt, cursor }
  @Get('corrupt') listCorrupt(@Query() q: CorruptQueryDto): Promise<CorruptListDto> // paged
  @Post('scrub')  @HttpCode(202) startScrub(@Req() req): Promise<{ triggered: boolean }> // manual kick
  ```
  `POST scrub` sets a one-shot "run now" flag the runner honours on its next tick (or calls
  `BackgroundService.runOnce('integrity-scrub', …)`); it does NOT bypass the byte/object budget.
  Audit the trigger via `AuditService.emit({ event: 'integrity.scrub.started', subject, requestId })`
  exactly like the reconcile trigger — no target coordinates in the payload.
- DTOs use `nestjs-zod` `createZodDto` (the admin convention). `CorruptQueryDto` caps
  `limit` (`z.coerce.number().int().min(1).max(200).default(50)`) and `offset` so the route
  can't become an unbounded scan. `CorruptObjectDto` = `{ bucket, key, checkedAt, detail }` —
  `detail` is the already-redacted 255-char column; the DTO never carries a URL/credential.
- Registration: add `IntegrityAdminModule` to the `ADMIN_CHILDREN` array in `admin.module.ts`
  (it is both spread into `imports` and listed as a RouterModule child so `/api/admin/integrity/*`
  mounts — see the module's doc comment).
- Frontend (mirror `replication.signal-store.ts` + `replication.component.ts`, signals + OnPush):
  - `IntegritySignalStore` (`providedIn: 'root'`): readonly signals `status`, `corrupt`,
    `loading`, `error`; `refresh()` calls the generated `IntegrityAdminService.getIntegrityStatus`;
    `scrubNow()` posts and polls `status`. A `computed()` `hasCorruption = () => (status()?.corrupt ?? 0) > 0`.
  - `IntegrityComponent`: a Settings tab with stat cards (scanned / ok / corrupt / repaired,
    reuse `StatCardComponent`), a corrupt-object table (reuse `HlmTableImports` + the shared
    `ListStateComponent`), a not-configured/clean panel when `corrupt === 0`, and a guarded
    "Scrub now" button. Add the tab to `settings.component.ts` (Replication/Backup already live
    there as `?tab=` tabs).
  - Console indicator: a small red badge with the corrupt count in the sidebar
    (`sidebar.data.ts` badge slot), bound to `IntegritySignalStore.corrupt` and hidden when 0 —
    the "small console indicator" from the story.
- Optional Prometheus gauge: if a `/metrics` endpoint is added, expose
  `openbucket_integrity_objects{status="corrupt|ok|unchecked"}` and
  `openbucket_integrity_last_run_timestamp` gauges sourced from `scrub_state`. If `prom-client`
  is introduced it MUST be added in ALL THREE manifests — `package.json`,
  `apps/openbucket-backend/package.json` (the source of `webpack.config.js`'s `externalDependencies`
  list), and `libs/nestjs/package.json` — so the embeddable lib and the standalone bundle agree.
  Alternatively, avoid the new dep by extending the existing in-memory `RequestMetricsService`.
  Either way `/metrics` exposes ONLY counts — never object keys, never target credentials
  (EPIC-08: `/metrics` must not leak secrets).
- Edge cases: `getStatus` is always 200 even when the scrub is disabled/unconfigured
  (`enabled:false`, zeroed counters) — matches `getReplicationStatus`. Read routes are not
  audited (v1 "no read auditing" rule); only the `POST scrub` trigger is.

## Acceptance criteria
- [ ] `GET /api/admin/integrity/status` returns the summary shape and is present in the OpenAPI export; unauthenticated calls are rejected by `JwtAuthGuard`.
- [ ] `GET /api/admin/integrity/corrupt` is paged and `limit`-capped; response contains no endpoint/credential field.
- [ ] The console shows a corrupt-count badge that hides at zero and an Integrity tab under Settings; `nx build openbucket-frontend` passes.
- [ ] If the Prometheus gauge lands, `/metrics` output contains `openbucket_integrity_*` and no object key or secret; any new dep appears in all three package manifests.
- [ ] `nx test nestjs --testPathPattern=integrity-admin` and the frontend signal-store spec pass.

## Test obligations
- Unit: covered by [TEST-1204] (status/corrupt DTO shape, limit cap, signal-store)
- E2E: covered by [TEST-1204] (authz on the routes; corrupt list reflects a seeded corrupt row)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3641], [TASK-3642]; optionally [TASK-3643] (repair counter in the summary)
