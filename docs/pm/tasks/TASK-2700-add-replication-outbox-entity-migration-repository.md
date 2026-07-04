---
id: TASK-2700
title: Add the replication_outbox entity, migration, and repository
story: STORY-0900
status: backlog
type: implementation
size: M
---

## Description

Create the durable outbox table that holds one replication intent per object
mutation. This is the persistence backbone for [STORY-0900]: rows are inserted in
the caller's write transaction ([TASK-2702]) and drained by the worker
([TASK-2703]). Mirrors the existing entity/repository/migration conventions
(`ObjectEntity`, `LifecycleState`, the explicit `migrationsList`).

## Files to create / modify

- `libs/nestjs/src/lib/persistence/entities/replication-outbox.entity.ts` — new (entity)
- `libs/nestjs/src/lib/persistence/repositories/replication-outbox.repository.ts` — new (repository)
- `libs/nestjs/src/lib/persistence/index.ts` — modify (export the entity + repo, matching barrel order)
- `libs/nestjs/src/lib/migrations/Migration20260710000001_replication_outbox.ts` — new (create table)
- `libs/nestjs/src/lib/persistence.module.ts` — modify (add to `ENTITIES`, `migrationsList`, and the repo-alias providers/exports)

## Implementation notes

- Entity shape (libsql, follow `object.entity.ts` decorators):
  ```ts
  @Entity({ tableName: 'replication_outbox', repository: () => ReplicationOutboxRepository })
  @Index({ name: 'ix_repl_outbox_due', properties: ['status', 'nextAttemptAt'] })
  @Index({ name: 'ix_repl_outbox_key', properties: ['bucket', 'key', 'seq'] })
  export class ReplicationOutbox {
    @PrimaryKey({ type: 'string' }) id!: string;              // uuidv7, service-generated
    @Property({ type: 'bigint' }) seq!: bigint;              // global FIFO / per-key order
    @ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' }) bucket!: Bucket;
    @Property({ type: 'text' }) key!: string;
    @Property({ type: 'string', length: 8 }) op!: 'PUT' | 'DELETE';
    @Property({ type: 'string', nullable: true }) versionId?: string;  // currentVersionId at enqueue
    @Property({ type: 'string', length: 64, nullable: true }) etag?: string;
    @Property({ type: 'bigint', nullable: true }) size?: bigint;
    @Property({ type: 'string', length: 255, nullable: true }) contentType?: string;
    @Property({ type: 'string', length: 16, default: 'pending' }) status!: 'pending' | 'failed' | 'done';
    @Property({ type: 'integer', default: 0 }) attempts = 0;
    @Property({ type: 'datetime' }) nextAttemptAt: Date = new Date();
    @Property({ type: 'text', nullable: true }) lastError?: string;
    @Property({ type: 'datetime' }) createdAt: Date = new Date();
    @Property({ type: 'datetime', onUpdate: () => new Date() }) updatedAt: Date = new Date();
  }
  ```
- `seq`: monotonic per-instance ordering. Generate as a UUIDv7-derived sortable
  value is possible, but a plain autoincrement is cleaner for `orderBy` — use a
  SQLite `integer` primary-companion. Simplest portable approach: keep `id` as the
  uuidv7 PK and give `seq` a DB `autoincrement`. In the migration declare
  `"seq" integer not null` backed by a `create table … "seq" integer` plus an
  `AUTOINCREMENT`-style rowid alias, or derive `seq` from a dedicated
  `sqlite_sequence`. Confirm the exact mechanism in [TASK-2704]; the worker only
  needs a total order consistent with insert order, so `rowid` ASC is acceptable
  and avoids a second column.
- Migration follows the `Migration20260701000001_object_content_sha256` template:
  forward-only `up()` with `create table "replication_outbox" (…)` and the two
  indexes; `down()` `drop table` for test convenience only. FK
  `bucket_name → buckets(name) on delete cascade` (so deleting a bucket drops its
  pending intents).
- Repository (`extends EntityRepository<ReplicationOutbox>`), read/claim helpers
  the worker will use:
  - `dueKeys(now: Date, limit: number): Promise<Array<{ bucket: string; key: string }>>`
    — distinct `(bucket, key)` having a `status='pending'` row with
    `nextAttemptAt <= now`, ordered by min `seq`, `limit` keys (bounds per-tick work).
  - `pendingForKey(bucket, key): Promise<ReplicationOutbox[]>` — all `pending`
    intents for a key ordered by `seq ASC` (the per-key chain the worker coalesces).
  - `countByStatus(): Promise<Record<string, number>>` — feeds STORY-0902 metrics.
- Register in `persistence.module.ts`: add `ReplicationOutbox` to `ENTITIES`,
  append the migration to `migrationsList` (webpack bundle needs the explicit
  entry — see the file's comment), and add the `ReplicationOutboxRepository`
  alias provider/export like the other repos.
- Edge cases / DoS: the table is unbounded during a long outage — this task only
  creates the schema; retention (drop `done` rows immediately, cap `failed`
  visibility) is enforced by the worker ([TASK-2703]) and surfaced by STORY-0902.
  Index `ix_repl_outbox_due` keeps the drain query O(log n) as the table grows.

## Acceptance criteria

- [ ] `nx test nestjs` picks up a new `replication-outbox.entity.spec.ts` (or the
      existing `entities.spec.ts`) that constructs and persists a row.
- [ ] Booting against a fresh `DATA_DIR` applies `Migration20260710000001_replication_outbox`
      and creates the table with both indexes (`PersistenceModule.onModuleInit` logs it).
- [ ] `ReplicationOutboxRepository.dueKeys` returns distinct keys ordered by `seq`,
      excluding rows whose `nextAttemptAt` is in the future.

## Test obligations

- Unit: covered by [TEST-0900] (entity persist + repository query cases)
- E2E: covered by [TEST-0900] (drain reads these rows)
- Conformance: N/A

## Dependencies

- Blocked by: —
