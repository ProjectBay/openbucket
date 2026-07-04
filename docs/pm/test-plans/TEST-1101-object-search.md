---
id: TEST-1101
title: Cross-bucket object search — repository, endpoint, and console
covers: [STORY-1101, TASK-3310, TASK-3311, TASK-3312, TASK-3313, TASK-3314]
status: backlog
level: integration
---

## Goal

Verify that cross-bucket object search returns correct, paginated results by
name/prefix and by indexed tag; that substring matching cannot be turned into a
SQL-`LIKE` wildcard injection (CWE-150); that the endpoint preserves the EPIC-08
admin auth/throttle posture; and that the console page drives it end to end.

## Setup

- Backend integration: boot the nestjs app with a fresh libsql DB (test mode),
  run migrations including `object_tags`. Seed ≥3 buckets (`alpha`, `beta`,
  `gamma`) with objects whose keys include shared prefixes across buckets
  (e.g. `photos/2024/a.jpg` in both `alpha` and `beta`), a key containing a
  literal `%` and one containing `_` (e.g. `reports/50%_off.pdf`), and a handful
  tagged `{ env: prod }` / `{ env: staging }`. Authenticate as the seeded admin
  to obtain a bearer (`admin/auth`).
- Repository unit tests: MikroORM against an in-memory/temp libsql, or the
  fake-EM contract pattern from `multipart.service.spec.ts`.
- Frontend: `object-search.component.spec.ts` with `ObjectsAdminService` mocked
  (return canned `ObjectSearchResponse` pages); `HttpTestingController` not needed.
- Tooling env: `OPENBUCKET_TEST_MODE=1`.

## Cases

1. **escapeLikePattern (TASK-3310).** Given inputs `a%b`, `a_b`, `a\b`, `a%_\b`,
   assert outputs `a\%b`, `a\_b`, `a\\b`, `a\%\_\\b` respectively — the escape
   char is doubled first, then `%` and `_` are prefixed.
2. **prefix mode uses a range scan, not LIKE (TASK-3310).** Assert the query built
   for `mode:'prefix', term:'photos/'` uses `key $gte 'photos/'` and
   `key $lt nextStringBound('photos/')` and contains no `LIKE` fragment (inspect
   the built QB / fake-EM contract, mirroring the `$like`-rejecting fake in
   `multipart.service.spec.ts`).
3. **keyset pagination is stable and gapless (TASK-3310).** With `limit:2` over 5
   cross-bucket matches ordered by `(bucket,key)`, page 1 returns 2 rows +
   `truncated:true`; feeding the last row's `(bucket,key)` cursor returns the next
   2 disjoint rows; the union across pages equals the full ordered match set with
   no repeats.
4. **contains matches wildcards literally (TASK-3310/3311).** `mode:'contains',
   q:'%'` returns ONLY `reports/50%_off.pdf` (the key with a real `%`), not every
   object; `q:'_off'` matches the literal `_`, not "any char + off".
5. **endpoint happy path across buckets (TASK-3311, e2e).** `GET
   /api/admin/objects/search?q=photos/&mode=prefix` with a valid bearer returns
   `200` with hits from both `alpha` and `beta`, ordered by `(bucket,key)`, each
   carrying `{ bucket, key, size, etag, lastModified, storageClass }`; walking
   `nextCursor` yields the remaining pages then `isTruncated:false`.
6. **auth + throttle posture preserved (TASK-3311, EPIC-08).** The same request
   with no `Authorization` header returns `401`; issuing >100 requests/min from one
   IP returns `429` (the `default` throttle bucket). No request consults the S3
   policy-evaluator (admin-plane surface).
7. **validation + DoS guards (TASK-3311).** `mode=contains&q=a` → `400` (min-length
   refinement); `limit=500` is clamped to 100 (response has ≤100 results); a
   malformed `cursor=not-base64` returns `200` starting from page 1, not `500`;
   `tagKey` without `tagValue` → `400`.
8. **tag write-path sync (TASK-3312).** `PUT …/tagging` with `{ env: prod }` inserts
   matching `object_tags` rows; overwriting with `{ env: staging }` replaces them
   (no stale `prod` row); `DELETE …/tagging` removes all rows for the object;
   deleting the object cascades its tag rows away.
9. **indexed tag search (TASK-3312, e2e).** `GET
   /api/admin/objects/search?q=&mode=prefix&tagKey=env&tagValue=prod` (or the
   documented tag-scoped form) returns exactly the `env=prod` objects across
   buckets and none of the `env=staging` ones; the backfill runner populates rows
   for objects tagged before the table existed and is a no-op on a caught-up index.
10. **console page drives the client (TASK-3313/3314).** In the component spec,
    typing a term (after debounce) calls the mocked `searchObjects` with the
    selected mode/filters; results render bucket + key + size + modified rows;
    loading/error/empty go through `ob-list-state`; "Next"/"Prev" push/pop the
    cursor stack; a result row's `routerLink` targets `/buckets/:bucket/browse`
    with the key encoded once; `contains` submit is disabled for `q.length < 2`.

## Tooling

- Framework: jest + supertest (backend), jest + Angular TestBed (frontend)
- Runner: `nx test nestjs`, `nx e2e nestjs-e2e` (or the backend e2e project),
  `nx test openbucket-frontend`; client gate `nx run api-client:check`

## Pass criteria

- [ ] Cases 1–4 (repository unit) pass.
- [ ] Cases 5–7, 9 (endpoint integration/e2e) pass, including the `401`/`429`/`400`
      guards and gapless keyset pagination.
- [ ] Case 8 (tag write-path + cascade) passes.
- [ ] Case 10 (console component) passes; `nx run api-client:check` is green.
- [ ] No search input path interpolates unbound user text into SQL, and no `prefix`
      search emits a `LIKE` (verified in cases 2 and 4).

## References

- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts`,
  `…/domain/multipart/multipart.service.spec.ts` (TASK-2162 / CWE-150 baseline)
- `libs/nestjs/src/lib/admin/objects/objects-search-admin.controller.ts` (new),
  `…/admin/admin.module.ts` (JwtAuthGuard + ThrottlerGuard)
- `libs/nestjs/src/lib/common/background/tag-index-backfill.runner.ts` (new)
- `apps/openbucket-frontend/src/app/objects/object-search.component.ts` (new),
  `…/shared/ui/list-state.component.ts`
