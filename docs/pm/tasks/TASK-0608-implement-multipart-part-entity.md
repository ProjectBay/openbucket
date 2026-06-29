---
id: TASK-0608
title: Implement `MultipartPart` entity
story: STORY-0202
status: done
type: implementation
size: S
---

## Description
Implement the per-part row for a multipart session. Composite PK `(upload, partNumber)`, FK cascades from the parent upload.

## Files to create / modify
- `libs/persistence/src/entities/multipart-part.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'multipart_parts' })`.
- `@Index({ name: 'ix_mpp_upload_part', properties: ['upload', 'partNumber'] })`.
- `@ManyToOne(() => MultipartUpload, { primary: true, fieldName: 'upload_id', deleteRule: 'cascade' }) upload!: MultipartUpload;`.
- `@PrimaryKey({ type: 'integer' }) partNumber!: number; // 1..10000 per S3 contract`.
- `@Property({ type: 'bigint' }) size: bigint = 0n;`.
- `@Property({ type: 'string', length: 64 }) etag!: string;`.
- `@Property({ type: 'string', length: 128, nullable: true }) checksumSha256?: string;` — optional sha256 from `x-amz-checksum-*` trailers.
- `@Property({ type: 'datetime' }) writtenAt: Date = new Date();`.

## Acceptance criteria
- [ ] Inserting two parts with the same `(upload, partNumber)` is rejected.
- [ ] `checksumSha256` can be left undefined and persists as `NULL`.

## Test obligations
- Unit: covered by [TEST-0202]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0607]

## References
- `docs/WHITEPAPER.md` §3.2.5 (lines 3336–3364)
