---
id: TASK-0605
title: Implement `ObjectEntity`
story: STORY-0201
status: done
type: implementation
size: S
---

## Description
Implement the current-pointer row for an `(bucket, key)` pair. Surrogate string PK `id` is uuid v7 generated in the service layer; `(bucket, key)` uniqueness is enforced by a `@Unique` constraint plus a covering index.

## Files to create / modify
- `libs/persistence/src/entities/object.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'objects' })`.
- `@Unique({ name: 'uq_objects_bucket_key', properties: ['bucket', 'key'] })`.
- `@Index({ name: 'ix_objects_bucket_key', properties: ['bucket', 'key'] })`.
- `@Index({ name: 'ix_objects_bucket_softdeleted', properties: ['bucket', 'softDeleted'] })`.
- `@PrimaryKey({ type: 'string' }) id!: string; // uuid v7 — generated in service layer`.
- `@ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' }) bucket!: Bucket;`.
- `@Property({ type: 'text' }) key!: string;`.
- `@Property({ type: 'string', nullable: true }) currentVersionId?: string;` — versionId of the version currently reachable via the path-mirror filename.
- `@Property({ type: 'bigint' }) size: bigint = 0n;`.
- `@Property({ type: 'string', length: 64 }) etag!: string;`.
- `@Property({ type: 'string', length: 255, default: 'application/octet-stream' }) contentType: string = 'application/octet-stream';`.
- JSON columns: `userMetadata?: Record<string, string>`, `tagging?: TagSet`, `lock?: ObjectLockObjectState`.
- `@Property({ type: 'string', default: StorageClass.Standard }) storageClass: StorageClass = StorageClass.Standard;`.
- `@Property({ type: 'boolean', default: false }) softDeleted: boolean = false;`.
- Timestamps `createdAt` and `modifiedAt` with `onUpdate` like §3.2.2.

## Acceptance criteria
- [ ] Insert two `ObjectEntity` rows with same `(bucket, key)` is rejected by the unique constraint.
- [ ] `size` round-trips through SQLite as `bigint`.
- [ ] `softDeleted` defaults to `false` on insert.

## Test obligations
- Unit: covered by [TEST-0201]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0603], [TASK-0604]

## References
- `docs/WHITEPAPER.md` §3.2.3 (lines 3187–3248)
