---
id: TASK-3312
title: Add the indexed object-tags table and tag-search wiring
story: STORY-1101
status: backlog
type: implementation
size: L
---

## Description

Make the "search by tag where indexed" clause real. Object tags today live in an
unindexed `objects.tagging` JSON column — unsearchable at scale. Add a
denormalised `object_tags` index table (one row per key/value pair), keep it in
sync on the tagging write path, backfill existing tags via a background-tick
runner, and wire `tagKey`/`tagValue` into `searchAcrossBuckets`.

## Files to create / modify

- `libs/nestjs/src/lib/persistence/entities/object-tag.entity.ts` — new
- `libs/nestjs/src/lib/migrations/Migration20260704000001_object_tags_index.ts` — new
- `libs/nestjs/src/lib/persistence/repositories/object.repository.ts` — modify
  (join `object_tags` when `tagKey`/`tagValue` set)
- `libs/nestjs/src/lib/domain/objects/object.service.ts` — modify (upsert/prune
  tag rows in `setTaggingMap` / `clearTaggingMap`)
- `libs/nestjs/src/lib/common/background/tag-index-backfill.runner.ts` — new
  (`ScheduledTask` implementing the backfill)
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify
  (register the runner under `SCHEDULED_TASKS`)
- `libs/nestjs/src/lib/mikro-orm.config.ts` + `persistence.module.ts` — modify
  (add `ObjectTag` to the explicit entity list — no glob scan)

## Implementation notes

- Entity / table `object_tags`:

  ```ts
  @Entity({ tableName: 'object_tags' })
  @Index({ name: 'ix_object_tags_kv', properties: ['tagKey', 'tagValue'] })
  @Index({ name: 'ix_object_tags_object', properties: ['object'] })
  export class ObjectTag {
    @PrimaryKey({ type: 'string' }) id!: string; // uuid v7
    @ManyToOne(() => ObjectEntity, { deleteRule: 'cascade', fieldName: 'object_id' })
    object!: ObjectEntity;
    @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' })
    bucket!: Bucket; // denormalised so search can order/keyset by bucket
    @Property({ type: 'string', length: 128 }) tagKey!: string;
    @Property({ type: 'string', length: 256 }) tagValue!: string;
  }
  ```

  `deleteRule: 'cascade'` on `object` means deleting the object row (or its
  bucket) reaps its tag rows automatically — no orphans. Migration mirrors the
  hand-written SQL style of `Migration20260701000001_object_content_sha256.ts`
  (forward-only in prod §3.3.2; `down()` for tests): `create table` + the two
  indexes.

- Write-path sync in `object.service.ts`: after `setTaggingMap(bucket, key, tags)`
  persists the JSON column, replace that object's `object_tags` rows in the same
  unit of work — `em.nativeDelete(ObjectTag, { object: obj.id })` then insert one
  row per entry of `tags`. `clearTaggingMap` deletes all rows for the object.
  Keep the JSON column as the source of truth; `object_tags` is a derived index,
  so a rebuild is always safe.

- Search join in `searchAcrossBuckets` (extends [TASK-3310]): when
  `tagKey`+`tagValue` are set,
  `qb.join('o.tags', 't').andWhere({ 't.tagKey': tagKey, 't.tagValue': tagValue })`
  (add an inverse `@OneToMany` `tags` on `ObjectEntity`, or join by id). This is an
  exact-match, index-backed filter (`ix_object_tags_kv`) — NOT a `LIKE`, so no
  wildcard concern. The name/prefix predicate still applies on top when `q` is a
  real term; when the search is tag-only the DTO still requires `q` (min 1), so
  callers pass `q=''`-equivalent via `mode=prefix` with empty-prefix semantics —
  document that `prefix` with a 1-char `q` plus a tag filter is the tag-scoped
  path, and keep the `q` predicate ANDed.

- Backfill runner (idempotent, resumable — model on `lifecycle-sweep.runner.ts`):
  implements `ScheduledTask` with `name = 'tag-index-backfill'`, a modest
  `intervalMs` (e.g. 5 min), a `BATCH_SIZE`/`MAX_BATCHES_PER_TICK` cap, and a
  per-tick `RequestContext` (provided by `BackgroundService`). Each tick pages
  objects that have a non-empty `tagging` JSON but no `object_tags` rows, inserts
  the missing rows, and yields between batches. Because inserts are `replace`
  semantics per object, re-running is safe and it self-terminates (no-op) once the
  index is caught up.

- Edge cases / DoS: cap `tagKey`/`tagValue` length in the DTO (done in
  [TASK-3311]); the backfill's batch/tick caps bound catch-up cost the same way
  the lifecycle sweep does; a tag row count is bounded by (#objects × #tags per
  object) which S3 caps at 10 tags/object. No user input reaches SQL unbound.

## Acceptance criteria

- [ ] `Migration20260704000001_object_tags_index` creates `object_tags` with
      `ix_object_tags_kv` + a FK cascade from `object_id`; `nx run
      openbucket-backend:migration:up` applies cleanly.
- [ ] Setting a tag via `putObjectTagging` inserts matching `object_tags` rows;
      clearing tags removes them; deleting the object cascades them away.
- [ ] `search?...&tagKey=env&tagValue=prod` returns only objects carrying that
      exact tag, across buckets, index-backed (no `LIKE`).
- [ ] The backfill runner populates rows for objects that had tags before the
      table existed and is a no-op once caught up.
- [ ] `nx test nestjs --testPathPattern=object.service.spec` and the repository
      spec pass with the tag-search cases.

## Test obligations

- Unit: covered by [TEST-1101] (cases 8, 9)
- E2E: covered by [TEST-1101] (case 5, tag-filter variant)
- Conformance: N/A

## Dependencies

- Blocked by: [TASK-3310], [TASK-3311]

## References

- `libs/nestjs/src/lib/persistence/entities/object.entity.ts` (`tagging` JSON,
  `TagSet`), `libs/nestjs/src/lib/domain/objects/object.service.ts`
  (`setTaggingMap`, `clearTaggingMap`)
- `libs/nestjs/src/lib/common/background/background.service.ts` (`ScheduledTask`,
  `SCHEDULED_TASKS`), `…/lifecycle-sweep.runner.ts` (batching/cursor pattern),
  `…/background.module.ts`
- `libs/nestjs/src/lib/migrations/Migration20260701000001_object_content_sha256.ts`
  (migration style), `libs/nestjs/src/lib/mikro-orm.config.ts` (explicit entity list)
