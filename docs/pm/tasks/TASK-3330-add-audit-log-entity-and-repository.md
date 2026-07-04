---
id: TASK-3330
title: Add AuditLog entity, repository, and migration
story: STORY-1103
status: backlog
type: infra
size: S
---

## Description
Introduce a durable store for audit events. Add an `AuditLog` MikroORM entity (table `audit_logs`), an `AuditLogRepository` with batch insert / keyset query / prune, and a forward-only migration, then register all three in the ORM config, the runtime `PersistenceModule`, and the persistence barrel. This is the schema foundation the sink ([TASK-3331]) and query API ([TASK-3332]) build on.

## Files to create / modify
- `libs/nestjs/src/lib/persistence/entities/audit-log.entity.ts` — new (entity `AuditLog`)
- `libs/nestjs/src/lib/persistence/repositories/audit-log.repository.ts` — new (`AuditLogRepository`, `AuditRow`, `AuditFilter`)
- `libs/nestjs/src/lib/migrations/Migration20260704000001_audit_logs.ts` — new
- `libs/nestjs/src/lib/persistence/index.ts` — modify (export entity + repository)
- `libs/nestjs/src/lib/mikro-orm.config.ts` — modify (add `AuditLog` to `entities[]`)
- `libs/nestjs/src/lib/persistence.module.ts` — modify (add `AuditLog` to `ENTITIES`, register `Migration20260704000001_audit_logs` in `migrationsList`, alias `AuditLogRepository` in providers/exports)

## Implementation notes
- Entity mirrors `refresh-token.entity.ts`. PK is a **uuid v7** string (time-ordered — pairs with `ts` for stable keyset paging). Columns and indexes:
  ```ts
  @Entity({ tableName: 'audit_logs', repository: () => AuditLogRepository })
  @Index({ name: 'ix_audit_ts', properties: ['ts'] })
  @Index({ name: 'ix_audit_event_ts', properties: ['event', 'ts'] })
  @Index({ name: 'ix_audit_subject_ts', properties: ['subject', 'ts'] })
  @Index({ name: 'ix_audit_bucket_ts', properties: ['bucket', 'ts'] })
  export class AuditLog {
    @PrimaryKey({ type: 'string', length: 64 }) id!: string;        // uuid v7
    @Property({ type: 'datetime' }) ts!: Date;                      // event time (UTC; forceUtcTimezone)
    @Property({ type: 'string', length: 64 }) event!: string;       // catalogue name, e.g. bucket.created
    @Property({ type: 'string', length: 256, nullable: true }) subject?: string | null; // null for admin.login.failed
    @Property({ type: 'string', length: 64, nullable: true }) requestId?: string | null;
    @Property({ type: 'string', length: 256, nullable: true }) bucket?: string | null;
    @Property({ type: 'string', length: 1024, nullable: true }) objectKey?: string | null;
    @Property({ type: 'string', length: 64, nullable: true }) keyId?: string | null;
    @Property({ type: 'string', length: 64, nullable: true }) ip?: string | null;
    @Property({ type: 'text', nullable: true }) detail?: string | null; // JSON of remaining whitelisted fields
  }
  ```
- `AuditLogRepository extends EntityRepository<AuditLog>` (import from `@mikro-orm/libsql`, like `refresh-token.repository.ts`):
  - `async insertMany(rows: AuditRow[]): Promise<void>` — `em.create` each + one `flush()` (batch).
  - `async query(f: AuditFilter): Promise<AuditLog[]>` — build `$and` of only-supplied filters (`event` exact, `subject` exact, `bucket` exact, `ts: { $gte: from, $lte: to }`), plus a keyset predicate from the cursor `(ts, id) < (cursorTs, cursorId)`; `orderBy: [{ ts: 'desc' }, { id: 'desc' }]`, `limit: f.limit + 1` (the extra row signals `hasMore`). No `$like` — filters are exact against indexed columns.
  - `async pruneOlderThan(cutoff: Date): Promise<number>` — `nativeDelete(AuditLog, { ts: { $lt: cutoff } })`.
- Migration SQL (libsql/sqlite, snake_case columns — MikroORM maps `requestId`→`request_id`, `objectKey`→`object_key`, `keyId`→`key_id`):
  ```sql
  create table "audit_logs" ("id" varchar(64) not null, "ts" datetime not null,
    "event" varchar(64) not null, "subject" varchar(256) null, "request_id" varchar(64) null,
    "bucket" varchar(256) null, "object_key" varchar(1024) null, "key_id" varchar(64) null,
    "ip" varchar(64) null, "detail" text null, constraint "audit_logs_pkey" primary key ("id"));
  create index "ix_audit_ts" on "audit_logs" ("ts");
  create index "ix_audit_event_ts" on "audit_logs" ("event", "ts");
  create index "ix_audit_subject_ts" on "audit_logs" ("subject", "ts");
  create index "ix_audit_bucket_ts" on "audit_logs" ("bucket", "ts");
  ```
  `down()` drops the table (test-suite convenience only; production is forward-only per §3.3.2).
- Register the migration in `migrationsList` (webpack bundling means glob discovery finds nothing — the list is explicit, see existing entries) and alias the repo in `PersistenceModule` providers/exports exactly like `RefreshTokenRepository`.
- Security/DoS: `event`/`subject`/`bucket` are the only filterable columns and all are indexed, so no query degrades to a table scan; `detail` is `text` but callers cap its size in [TASK-3331].

## Acceptance criteria
- [ ] `nx test nestjs --testPathPattern=entities.spec` (or the persistence spec) discovers `AuditLog` without metadata errors.
- [ ] Booting the app applies `Migration20260704000001_audit_logs`; `audit_logs` and its four indexes exist.
- [ ] `AuditLogRepository.query` returns rows newest-first and honours a `(ts, id)` cursor; `insertMany` persists a batch in one flush; `pruneOlderThan` returns the deleted count.
- [ ] `AuditLogRepository` is injectable via its class token (aliased in `PersistenceModule`).

## Test obligations
- Unit: covered by [TEST-1103] (repository query/keyset/prune cases)
- E2E: covered by [TEST-1103]
- Conformance: N/A

## Dependencies
- Blocked by: [STORY-0413]
</content>
