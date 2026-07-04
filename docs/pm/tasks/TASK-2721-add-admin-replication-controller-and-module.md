---
id: TASK-2721
title: Add the admin replication controller and module wiring
story: STORY-0902
status: backlog
type: implementation
size: M
---

## Description

Expose the replication read model and the reconcile trigger as a JWT-guarded admin
REST surface under `/api/admin/replication`, following the thin-adapter controller
pattern of `BucketsAdminController`. Wire a new `ReplicationAdminModule` into
`ADMIN_CONTROLLER_MODULES` so it mounts under both the standalone app and the
embeddable `RouterModule` host mount.

## Files to create / modify

- `libs/nestjs/src/lib/admin/replication/replication-admin.controller.ts` — new
- `libs/nestjs/src/lib/admin/replication/replication-admin.controller.spec.ts` — new
- `libs/nestjs/src/lib/admin/replication/replication-admin.module.ts` — new
- `libs/nestjs/src/lib/admin/replication/dto/reconcile-request.dto.ts` — new
- `libs/nestjs/src/lib/admin/replication/dto/reconcile-job.dto.ts` — new
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify (add to `ADMIN_CONTROLLER_MODULES`)
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` — modify (extend event catalogue doc-comment)

## Implementation notes

- Controller (unlike `BackupController`, this is JSON so it is NOT
  `@ApiExcludeController()` — it must appear in the OpenAPI doc for the client):
  ```ts
  @Controller('api/admin/replication')
  export class ReplicationAdminController {
    constructor(
      private readonly status: ReplicationStatusService,   // TASK-2720
      private readonly reconcile: ReconcileService,         // TASK-2722
      private readonly audit: AuditService,
    ) {}

    @Get('status')
    @ApiOperation({ operationId: 'getReplicationStatus' })
    @ApiOkResponse({ type: ReplicationStatusDto })
    getStatus(): Promise<ReplicationStatusDto>;

    @Post('reconcile')
    @HttpCode(202)
    @ApiOperation({ operationId: 'startReconcile' })
    @ApiCreatedResponse({ type: ReconcileJobDto })
    startReconcile(@Body() dto: ReconcileRequestDto, @Req() req): Promise<ReconcileJobDto>;

    @Get('reconcile/:jobId')
    @ApiOperation({ operationId: 'getReconcileJob' })
    @ApiOkResponse({ type: ReconcileJobDto })
    getJob(@Param('jobId') jobId: string): Promise<ReconcileJobDto>;
  }
  ```
- `ReconcileRequestDto`: `{ bucket?: string }` (`z.object({ bucket: z.string().min(1).optional() }).strict()`). Omitted bucket = whole-instance reconcile.
- `ReconcileJobDto`: `{ jobId, scope: 'instance'|'bucket', bucket?, state: 'queued'|'running'|'completed'|'failed', localScanned, remoteScanned, missingRequeued, startedAt, finishedAt?, error? }` with `.meta({ id: 'ReconcileJob' })`.
- `startReconcile` delegates single-flight enforcement to `ReconcileService.start(...)` ([TASK-2722]); when a job is already active it throws `ConflictException` → `409` (do not start a second scan).
- Audit: emit `replication.reconcile.started` (`subject`, `jobId`, `bucket?`) on accept and let the runner emit `replication.reconcile.completed` (`subject`, `jobId`, counts). Add both rows to the audit catalogue doc-comment. **Never** put remote endpoint/credentials in an audit event. Read-only `GET /status` is not audited (consistent with the v1 "no read auditing" rule).
- Module:
  ```ts
  @Module({
    imports: [DomainModule],           // ReplicationStatusService (TASK-2720)
    controllers: [ReplicationAdminController],
    providers: [ReconcileService, AuditService],
  })
  export class ReplicationAdminModule {}
  ```
  Then add `ReplicationAdminModule` to the exported `ADMIN_CONTROLLER_MODULES`
  array — the RouterModule host mount in `open-bucket.module.ts` picks it up
  automatically (it spreads that constant), so no second edit is needed there.
- Security/DoS: all routes are covered by the global `JwtAuthGuard` (no `@Public()`)
  and the `default` 100/min throttler bucket bound app-wide in `admin.module.ts`.
  `POST /reconcile` is additionally single-flight in the service, so throttling +
  single-flight together bound remote-listing load.

## Acceptance criteria

- [ ] `nx test nestjs --testFile=replication-admin.controller.spec.ts` passes.
- [ ] Routes reachable at `/api/admin/replication/{status,reconcile,reconcile/:jobId}`; all return `401` without a JWT.
- [ ] A second `POST /reconcile` while a job is `running` returns `409`.
- [ ] `nx run openbucket-backend:openapi:export` emits `operationId`s `getReplicationStatus`, `startReconcile`, `getReconcileJob`.
- [ ] The audit catalogue lists `replication.reconcile.started` / `.completed` and neither event carries remote target config.

## Test obligations

- Unit: covered by [TEST-0902] (controller mapping + 409 single-flight)
- E2E: covered by [TEST-0902] (auth gate + route reachability)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-2720], [TASK-2722]

## References

- `libs/nestjs/src/lib/admin/buckets/buckets-admin.controller.ts` (thin adapter + `@ApiOperation`/`@ApiOkResponse`)
- `libs/nestjs/src/lib/admin/admin.module.ts` (`ADMIN_CONTROLLER_MODULES`), `open-bucket.module.ts` (children)
- `libs/nestjs/src/lib/admin/objects/objects-admin.module.ts` (module shape)
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` (event catalogue)
</content>
