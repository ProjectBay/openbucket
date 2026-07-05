---
id: TASK-3641
title: Add per-object integrity status columns, migration, and paged scan query
story: STORY-1204
status: backlog
type: implementation
size: M
---

## Description
Persist a per-object integrity verdict on `ObjectEntity` so the scrub result survives
restarts and can be queried by the admin surface. Add the columns, a MikroORM migration,
and a repository method that pages current/local/non-soft-deleted objects for the scrubber
plus a query for the admin "corrupt list".

## Files to create / modify
- `libs/nestjs/src/lib/persistence/entities/object.entity.ts` — modify (add 3 columns + index + enum)
- `libs/nestjs/src/lib/persistence/entities/types.ts` — modify (add `IntegrityStatus` enum)
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` — modify (scan + corrupt-list queries)
- `libs/nestjs/src/lib/migrations/Migration20260716000001_object_integrity.ts` — new

## Implementation notes
- Enum + columns (nullable/defaulted so every pre-existing row is valid and simply
  `unchecked` until the scrub reaches it — mirror how `contentSha256` was added nullable):
  ```ts
  export enum IntegrityStatus { Unchecked = 'unchecked', Ok = 'ok', Corrupt = 'corrupt' }

  @Property({ type: 'string', default: IntegrityStatus.Unchecked })
  integrityStatus: IntegrityStatus = IntegrityStatus.Unchecked;

  @Property({ type: 'datetime', nullable: true })
  integrityCheckedAt?: Date;

  /** Bounded, redacted diagnostic on corruption/repair (≤255). Never a credential. */
  @Property({ type: 'string', length: 255, nullable: true })
  integrityDetail?: string;
  ```
- Add `@Index({ name: 'ix_objects_integrity', properties: ['integrityStatus', 'integrityCheckedAt'] })`
  so the admin corrupt-list is an index scan and the scrubber can prefer least-recently-checked
  rows without a full-table sort.
- Migration: follow the `Migration20260712000001_reconcile_job.ts` shape — raw
  `ALTER TABLE objects ADD COLUMN ...` for the three columns (SQLite adds columns cheaply,
  no table rebuild) plus `CREATE INDEX ix_objects_integrity`. `down()` drops the index and
  columns. File name follows the `MigrationYYYYMMDD000001_<slug>.ts` convention.
- Repository — scrubber paging (cursor by `(bucket, key)`, the same indexed range scan the
  tiering/reconcile runners use, NOT `LIKE`):
  ```ts
  scanForScrub(input: {
    afterBucket?: string; afterKey?: string; limit: number;
  }): Promise<ObjectEntity[]>;   // WHERE softDeleted=false AND location='local'
                                 //   AND currentVersionId matches the mirror row
                                 //   AND contentSha256 IS NOT NULL
                                 // ORDER BY bucket_name, key  (stable cursor)
  ```
  and corrupt-list for the admin route:
  ```ts
  listCorrupt(input: { limit: number; offset: number }):
    Promise<{ rows: ObjectEntity[]; total: number }>; // WHERE integrityStatus='corrupt'
  ```
- Edge cases: tiered objects (`location !== 'local'`) are excluded — their bytes live on the
  remote and are re-verified on rehydrate (`tiering.service.ts` already checks `contentSha256`).
  Rows with a null `contentSha256` (pre-F1 writes) are skipped, not marked corrupt.
- Security/DoS: `listCorrupt` is offset+limit bounded (cap `limit` at e.g. 200 in the DTO) so
  the admin endpoint can't be turned into an unbounded scan. `integrityDetail` is a bounded
  255-char column written only from redacted strings.

## Acceptance criteria
- [ ] `nx run nestjs:migration-check` (or the repo's migration test) shows the up/down migration applies cleanly on a fresh and an existing DB.
- [ ] New rows default to `integrityStatus='unchecked'`; existing rows are untouched and readable.
- [ ] `scanForScrub` returns only current, local, non-soft-deleted, sha-bearing rows in `(bucket,key)` order and honours the cursor.
- [ ] `nx test nestjs --testPathPattern=object.repository` passes with the new query specs.

## Test obligations
- Unit: covered by [TEST-1204] (scanForScrub cursor + listCorrupt paging)
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [STORY-0201] (object entity), [STORY-0205] (migration baseline)
