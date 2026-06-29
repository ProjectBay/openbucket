---
id: TASK-0606
title: Implement `ObjectVersion` entity
story: STORY-0201
status: done
type: implementation
size: S
---

## Description
Implement the per-version row for a key. Composite primary key `(bucket, key, versionId)`. Delete-markers are rows with `isDeleteMarker = true` and no blob on disk under `<key>.v/`.

## Files to create / modify
- `libs/persistence/src/entities/object-version.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'object_versions' })`.
- `@Index({ name: 'ix_versions_bucket_key_version', properties: ['bucket', 'key', 'versionId'] })`.
- `@Index({ name: 'ix_versions_bucket_key_created', properties: ['bucket', 'key', 'createdAt'] })`.
- Composite PK declared via three primary fields:
  - `@ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' }) bucket!: Bucket;`
  - `@PrimaryKey({ type: 'text' }) key!: string;`
  - `@PrimaryKey({ type: 'string', length: 64 }) versionId!: string; // uuid v7`
- `@Property({ type: 'bigint' }) size: bigint = 0n;`.
- `@Property({ type: 'string', length: 64 }) etag!: string;`.
- `@Property({ type: 'string', length: 255, default: 'application/octet-stream' }) contentType: string = 'application/octet-stream';`.
- `@Property({ type: 'json', nullable: true }) userMetadata?: Record<string, string>;`.
- `@Property({ type: 'boolean', default: false }) isDeleteMarker: boolean = false;`.
- `@Property({ type: 'datetime' }) createdAt: Date = new Date();`.

## Acceptance criteria
- [ ] Inserting two rows with the same `(bucket, key, versionId)` is rejected.
- [ ] A row with `isDeleteMarker = true` and `size = 0n` persists without error.
- [ ] `ix_versions_bucket_key_created` is visible in `select * from sqlite_master where type='index'` after migration.

## Test obligations
- Unit: covered by [TEST-0201]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0603], [TASK-0604]

## References
- `docs/WHITEPAPER.md` §3.2.4 (lines 3250–3291)
