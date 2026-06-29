---
id: TASK-0607
title: Implement `MultipartUpload` entity
story: STORY-0202
status: done
type: implementation
size: S
---

## Description
Implement the parent entity for an in-progress multipart session. Owns the `parts` collection with `orphanRemoval: true` so deleting the upload removes all part rows.

## Files to create / modify
- `libs/persistence/src/entities/multipart-upload.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'multipart_uploads' })`.
- `@Index({ name: 'ix_mpu_bucket_key', properties: ['bucket', 'key'] })`.
- `@Index({ name: 'ix_mpu_initiated', properties: ['initiatedAt'] })`.
- `@PrimaryKey({ type: 'string', length: 64 }) uploadId!: string; // uuid v7`.
- `@ManyToOne(() => Bucket, { fieldName: 'bucket_name', deleteRule: 'cascade' }) bucket!: Bucket;`.
- `@Property({ type: 'text' }) key!: string;`.
- `@Property({ type: 'string', length: 128, default: 'root' }) initiator: string = 'root';`.
- `@Property({ type: 'json', nullable: true }) encryption?: EncryptionConfig;`.
- `@Property({ type: 'string', length: 255, default: 'application/octet-stream' }) contentType: string = 'application/octet-stream';`.
- `@Property({ type: 'json', nullable: true }) userMetadata?: Record<string, string>;`.
- `@Property({ type: 'datetime' }) initiatedAt: Date = new Date();`.
- `@OneToMany(() => MultipartPart, (p) => p.upload, { orphanRemoval: true }) parts = new Collection<MultipartPart>(this);`.

## Acceptance criteria
- [ ] Entity persists with default `initiator = 'root'` when not provided.
- [ ] Deleting a `MultipartUpload` cascades to its `MultipartPart` rows via `orphanRemoval`.

## Test obligations
- Unit: covered by [TEST-0202]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0603], [TASK-0604]

## References
- `docs/WHITEPAPER.md` §3.2.5 (lines 3293–3334)
