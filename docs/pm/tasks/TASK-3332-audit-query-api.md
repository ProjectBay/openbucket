---
id: TASK-3332
title: Audit query service, admin controller, and zod DTOs
story: STORY-1103
status: backlog
type: implementation
size: M
---

## Description
Expose the persisted audit events over a read-only admin API. Add an `AuditQueryService` (domain layer) that translates a validated query DTO into an `AuditFilter` and encodes an opaque keyset cursor, an `AuditAdminController` at `api/admin/audit`, and nestjs-zod DTOs for the query, the row, the page, and the static event catalogue. Wire it into the admin routing tree so it inherits the global `JwtAuthGuard` and throttler.

## Files to create / modify
- `libs/nestjs/src/lib/domain/audit/audit-query.service.ts` — new (`AuditQueryService`)
- `libs/nestjs/src/lib/admin/audit/audit-admin.controller.ts` — new (`AuditAdminController`)
- `libs/nestjs/src/lib/admin/audit/audit-admin.module.ts` — new (controller + `AuditQueryService`)
- `libs/nestjs/src/lib/admin/audit/dto/audit-query.dto.ts` — new (`AuditQueryDto`)
- `libs/nestjs/src/lib/admin/audit/dto/audit-event.dto.ts` — new (`AuditEventDto`)
- `libs/nestjs/src/lib/admin/audit/dto/audit-page.dto.ts` — new (`AuditPageDto`)
- `libs/nestjs/src/lib/admin/audit/dto/audit-catalog.dto.ts` — new (`AuditCatalogDto`)
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify (add `AuditAdminModule` to `ADMIN_CONTROLLER_MODULES`)
- `libs/nestjs/src/lib/open-bucket.module.ts` — modify (list `AuditAdminModule` as a RouterModule child so `/api/admin/audit` is mounted)

## Implementation notes
- DTOs use `createZodDto` (mirror `admin/objects/dto/list-objects-response.dto.ts` and `keys/dto/create-key.dto.ts`). `z.coerce`/`.strict()` where relevant — Express delivers query values as strings:
  ```ts
  export const AuditQuerySchema = z.object({
    event: z.string().max(64).optional(),
    subject: z.string().max(256).optional(),
    bucket: z.string().max(256).optional(),
    from: z.string().datetime().optional(),   // ISO 8601
    to: z.string().datetime().optional(),
    cursor: z.string().max(256).optional(),    // opaque, from a previous page
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
  export const AuditEventSchema = z.object({
    id: z.string(), ts: z.string().datetime(), event: z.string(),
    subject: z.string().nullable(), requestId: z.string().nullable(),
    bucket: z.string().nullable(), objectKey: z.string().nullable(),
    keyId: z.string().nullable(), ip: z.string().nullable(),
    detail: z.record(z.string(), z.unknown()).nullable(),
  }).meta({ id: 'AuditEvent' });
  export const AuditPageSchema = z.object({
    items: z.array(AuditEventSchema),
    nextCursor: z.string().nullable(),         // null when no more pages
  });
  export const AuditCatalogSchema = z.object({ events: z.array(z.string()) });
  ```
  `.meta({ id: 'AuditEvent' })` names the reusable OpenAPI component (zod 4) so the generated client emits a shared model, as `ObjectListItem` does.
- `AuditQueryService` (inject `AuditLogRepository`):
  - `list(q: AuditQueryDto): Promise<AuditPageDto>` — decode `cursor` → `{ ts, id }`; build `AuditFilter { event, subject, bucket, from: from&&new Date, to: to&&new Date, before, limit }`; call `repo.query`; if it returned `limit + 1` rows, pop the extra, set `nextCursor = encode(last.ts, last.id)`, else `null`; map entities → DTO (parse `detail` JSON back to an object).
  - Cursor is opaque: `base64url(`${ts.toISOString()}|${id}`)`; reject malformed cursors with `BadRequestException` (never trust client-supplied paging state).
  - `catalog(): AuditCatalogDto` — return the static v1 event names (export the list as a `const AUDIT_EVENT_CATALOG` next to the catalogue JSDoc in `audit.service.ts`, single source of truth) so the SPA filter dropdown needs no table scan.
- Controller (mirror `keys-admin.controller.ts` — `@ApiOperation({ operationId })`, `@ApiOkResponse`):
  ```ts
  @Controller('api/admin/audit')
  export class AuditAdminController {
    @Get() @ApiOperation({ operationId: 'listAuditEvents' }) @ApiOkResponse({ type: AuditPageDto })
    list(@Query() q: AuditQueryDto): Promise<AuditPageDto> { return this.svc.list(q); }
    @Get('catalog') @ApiOperation({ operationId: 'getAuditCatalog' }) @ApiOkResponse({ type: AuditCatalogDto })
    catalog(): AuditCatalogDto { return this.svc.catalog(); }
  }
  ```
- **Security / DoS (EPIC-08 posture preserved):** both routes are `GET` under the admin tree, so the global `JwtAuthGuard` (bound in `admin.module.ts` via `APP_GUARD`) authenticates them and the `default` throttler (100/min per IP) applies — no new guard, no `@Public()`. They are read-only, so **no** `audit.emit` (consistent with "read-only GETs are not audited"). Filters hit only indexed columns via exact match; `limit ≤ 200` + keyset paging bounds every response; the opaque cursor prevents offset-scan abuse. The audit query surface is admin-plane only — it does not touch `s3/authz/policy-evaluator` or `storage/key-codec` and must not be exposed on the S3 data plane.
- Register in BOTH `ADMIN_CONTROLLER_MODULES` (so the module's `AuditQueryService`/controller are provided) AND the `open-bucket.module.ts` RouterModule children — per the `admin.module.ts` JSDoc, RouterModule only prefixes listed modules' own controllers.

## Acceptance criteria
- [ ] `GET /api/admin/audit` without a valid admin JWT returns 401; with one it returns `{ items, nextCursor }` newest-first.
- [ ] `event`/`subject`/`bucket`/`from`/`to` filters narrow results; paging via `nextCursor` returns the next page with no overlap and terminates with `nextCursor: null`.
- [ ] `limit` above 200 is rejected by the DTO (422); a malformed `cursor` yields 400.
- [ ] `GET /api/admin/audit/catalog` returns the static event-name list.
- [ ] OpenAPI export (`nx run openbucket-backend:openapi:export`) contains `listAuditEvents` and `getAuditCatalog`; `nx test nestjs --testPathPattern=audit` passes.

## Test obligations
- Unit: covered by [TEST-1103] (query service: filter build, cursor encode/decode, `nextCursor`)
- E2E: covered by [TEST-1103] (HTTP: auth, filters, paging, validation)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3330], [TASK-3331]
</content>
