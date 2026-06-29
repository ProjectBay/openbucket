---
id: TASK-0614
title: Author initial migration with full up/down SQL
story: STORY-0205
status: done
type: implementation
size: M
---

## Description
Write the single initial migration file, `Migration20260520000001_initial.ts`. The `up()` method runs nine `addSql(...)` blocks creating every table, plus six additional `addSql(...)` calls creating indexes. `down()` drops the nine tables in reverse FK order for unit-test convenience only.

## Files to create / modify
- `apps/openbucket-backend/src/migrations/Migration20260520000001_initial.ts` — new

## Implementation notes
- Class signature: `export class Migration20260520000001_initial extends Migration { ... }` from `@mikro-orm/migrations`.
- Column types and defaults must match the entity decorators in [STORY-0201..0204] verbatim. Critical snippets (from §3.3.1):
  - `buckets`: `name text not null primary key`, `region text not null default 'us-east-1'`, `versioning text not null default 'disabled'`, then `object_lock`, `encryption`, `cors`, `lifecycle`, `tagging`, `policy` all `text null`, plus `created_at datetime not null` and `modified_at datetime not null`.
  - `objects`: `id text not null primary key`, `bucket_name text not null`, `key text not null`, `current_version_id text null`, `size bigint not null default 0`, `etag text not null`, `content_type text not null default 'application/octet-stream'`, `user_metadata text null`, `tagging text null`, `lock text null`, `storage_class text not null default 'STANDARD'`, `soft_deleted boolean not null default 0`, timestamps, plus `constraint "fk_objects_bucket" foreign key ("bucket_name") references "buckets" ("name") on delete cascade`.
  - Indexes after `objects`: `create unique index "uq_objects_bucket_key" on "objects" ("bucket_name", "key");`, `create index "ix_objects_bucket_key" on "objects" ("bucket_name", "key");`, `create index "ix_objects_bucket_softdeleted" on "objects" ("bucket_name", "soft_deleted");`.
  - `object_versions`: composite PK `("bucket_name", "key", "version_id")`, FK `fk_versions_bucket` cascading from buckets, indexes `ix_versions_bucket_key_version` and `ix_versions_bucket_key_created`.
  - `multipart_uploads`: PK `upload_id`, FK `fk_mpu_bucket`, indexes `ix_mpu_bucket_key` and `ix_mpu_initiated`.
  - `multipart_parts`: composite PK `("upload_id", "part_number")`, FK `fk_mpp_upload`, index `ix_mpp_upload_part`.
  - `access_keys`: PK `access_key_id`, columns `secret_hash`, `label` default `''`, `created_at`, `disabled boolean not null default 0`.
  - `admin_users`: PK `username`, columns `password_hash`, `created_at`.
  - `refresh_tokens`: PK `id`, columns `token_hash`, `subject`, `issued_at`, `expires_at`, `rotated_from text null`, indexes `ix_refresh_subject` and `ix_refresh_expires`.
  - `lifecycle_state`: composite PK `("bucket_name", "rule_id")`, FK `fk_lcs_bucket`.
- `down()` drops in this exact order: `lifecycle_state`, `refresh_tokens`, `admin_users`, `access_keys`, `multipart_parts`, `multipart_uploads`, `object_versions`, `objects`, `buckets`.
- Filename includes the date stamp `20260520000001`.

## Acceptance criteria
- [ ] `npm run -w apps/openbucket-backend orm:migration:up` against an empty `DATA_DIR` reports the migration applied.
- [ ] After `up()`, `select name from sqlite_master where type='table'` returns the nine table names.
- [ ] After `up()`, `select name from sqlite_master where type='index'` includes all six declared indexes plus the unique index.
- [ ] `down()` drops every table created by `up()` (verified by a unit test against `:memory:`).

## Test obligations
- Unit: covered by [TEST-0205]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0613]

## References
- `docs/WHITEPAPER.md` §3.3.1 (lines 3497–3668)
