---
id: TASK-0604
title: Implement `Bucket` entity
story: STORY-0201
status: done
type: implementation
size: S
---

## Description
Implement the `Bucket` entity with the seven JSON-typed configuration columns, the `region`/`versioning` defaults, the create/modify timestamps with `onUpdate`, and the back-collection of `ObjectEntity`.

## Files to create / modify
- `libs/persistence/src/entities/bucket.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'buckets' })`.
- PK: `@PrimaryKey({ type: 'string', length: 63 }) name!: string;`.
- `@Property({ type: 'string', length: 32, default: 'us-east-1' }) region: string = 'us-east-1';`.
- `@Property({ type: 'string', default: VersioningState.Disabled }) versioning: VersioningState = VersioningState.Disabled;`.
- JSON columns (each `@Property({ type: 'json', nullable: true })`): `objectLock?: ObjectLockBucketConfig`, `encryption?: EncryptionConfig`, `cors?: CorsRule[]`, `lifecycle?: LifecycleRule[]`, `tagging?: TagSet`, `policy?: PolicyDocument`.
- Timestamps: `@Property({ type: 'datetime' }) createdAt: Date = new Date();` and `@Property({ type: 'datetime', onUpdate: () => new Date() }) modifiedAt: Date = new Date();`.
- `@OneToMany(() => ObjectEntity, (o) => o.bucket) objects = new Collection<ObjectEntity>(this);`.

## Acceptance criteria
- [ ] Entity compiles under `nx build persistence`.
- [ ] Inserting a `Bucket` with default `region` and `versioning` against in-memory SQLite produces `region = 'us-east-1'` and `versioning = 'disabled'` on read-back.
- [ ] Round-tripping a JSON `cors` array preserves order and field shape.

## Test obligations
- Unit: covered by [TEST-0201]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0603]

## References
- `docs/WHITEPAPER.md` §3.2.2 (lines 3130–3185)
