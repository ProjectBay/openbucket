---
id: STORY-1101
title: Cross-bucket object search
epic: EPIC-12
status: backlog
size: M
risk: medium
---

## User story

As an operator, I want to search objects by name/prefix (and tag where indexed)
across all buckets from one place, so that I can locate a key without knowing —
or clicking through — which bucket it lives in.

## Description

Adds a cross-bucket admin search: a new `GET /api/admin/objects/search` endpoint
that queries the `objects` metadata table (across every bucket, not scoped to
one) plus a console page that drives it. Two match modes are supported: `prefix`
(an indexed byte-wise range scan, mirroring the existing S3 listing path) and
`contains` (a `LIKE '%…%' ESCAPE` substring match with the wildcards escaped),
with optional narrowing to a single bucket and an optional indexed tag filter
(`tagKey`/`tagValue`) backed by a denormalised `object_tags` table. Results are
keyset-paginated over `(bucket, key)` — never `OFFSET` — so deep pages stay cheap
and stable. The surface reuses the existing admin auth/throttle posture and the
`ObjectService`/repository layering; it exposes nothing the per-bucket
`listObjects` endpoint does not already expose.

## Acceptance criteria

- [ ] `GET /api/admin/objects/search?q=<term>&mode=prefix` returns matching objects
      across all buckets, each row carrying `{ bucket, key, size, etag,
      lastModified, storageClass }`, ordered by `(bucket ASC, key ASC)`.
- [ ] `mode=contains` performs a substring match in which a `q` containing `%`,
      `_`, or the escape char matches those characters literally (no wildcard
      injection — CWE-150), verified against the multipart/list hardening baseline
      (TASK-2162).
- [ ] An optional `bucket=<name>` narrows the search to one bucket; an optional
      `tagKey`+`tagValue` narrows to objects carrying that exact tag.
- [ ] Pagination is keyset-based: the response returns `nextCursor` +
      `isTruncated`; passing `cursor` back returns the next page with no gaps or
      repeats when the underlying table is unchanged.
- [ ] `limit` is clamped to `[1,100]` (default 50); `contains` mode rejects a `q`
      shorter than 2 characters; the endpoint is behind the global `JwtAuthGuard`
      and the `default` throttle bucket (100/min/IP) — an unauthenticated call is
      `401`.
- [ ] The console exposes a `/search` page (sidebar entry) that debounces input,
      shows loading/error/empty states via `ob-list-state`, and links each result
      row to that object in the bucket browser.
- [ ] `nx run api-client:check` passes (the regenerated client contains
      `searchObjects` and the search DTOs).

## Tasks

- [TASK-3310] Add cross-bucket search repository query + LIKE-escape helper
- [TASK-3311] Expose the admin object-search endpoint and DTOs
- [TASK-3312] Add the indexed object-tags table and tag-search wiring
- [TASK-3313] Regenerate the typed API client for the search endpoint
- [TASK-3314] Build the cross-bucket search console page

## Test plan

- [TEST-1101] Cross-bucket object search — repository, endpoint, and console

## Dependencies

- Blocks: —
- Blocked by: none functionally. Reuses the EPIC-08 admin security posture
  (`JwtAuthGuard` via `admin/auth/jwt-auth.guard.ts`, `ThrottlerGuard`/`s3-throttle`
  from `admin/admin.module.ts`) — the search endpoint MUST NOT introduce a new
  auth path or a policy bypass. It is an admin-superuser read, peer to the
  existing `objects-admin.controller.ts` listing; it does not consult the S3
  `s3/authz/policy-evaluator.ts` (that guards the S3 data plane, not the admin
  API) and does not change key handling (keys are stored raw UTF-8 in the DB;
  `storage/key-codec.ts` governs only the on-disk path mirror).

## References

- Backend: `libs/nestjs/src/lib/persistence/repositories/object.repository.ts`
  (`listByPrefix`, `nextStringBound`), `libs/nestjs/src/lib/persistence/entities/object.entity.ts`
  (`ix_objects_bucket_key`, `tagging` JSON column), `libs/nestjs/src/lib/domain/objects/object.service.ts`
  (`AdminObjectListItem`, `setTaggingMap`/`clearTaggingMap`), `libs/nestjs/src/lib/admin/objects/objects-admin.controller.ts`,
  `libs/nestjs/src/lib/admin/objects/objects-admin.module.ts`, `libs/nestjs/src/lib/admin/objects/dto/list-objects-query.dto.ts`.
- Hardening baseline: `libs/nestjs/src/lib/domain/multipart/multipart.service.ts`
  (TASK-2162 / CWE-150 note on avoiding `$like` wildcard injection).
- Background tick: `libs/nestjs/src/lib/common/background/background.service.ts`
  (`ScheduledTask`, `SCHEDULED_TASKS`), `libs/nestjs/src/lib/common/background/lifecycle-sweep.runner.ts`.
- Migrations: `libs/nestjs/src/lib/migrations/` (e.g. `Migration20260701000001_object_content_sha256.ts`).
- Frontend: `apps/openbucket-frontend/src/app/app.routes.ts`, `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`,
  `apps/openbucket-frontend/src/app/shared/ui/list-state.component.ts`, `apps/openbucket-frontend/src/app/layout/sidebar/data/sidebar.data.ts`.
- API client: `libs/api-client/project.json` (`generate`/`check` targets), `@openbucket/api-client`.
- New deps: none (no `sharp` / `@aws-sdk/client-s3` required; uses the existing
  `nestjs-zod`, MikroORM/libsql, `@openapitools/openapi-generator-cli`, spartan-ui).
