---
id: STORY-0408
title: Establish nestjs-zod DTO pattern with sample DTOs
epic: EPIC-05
status: done
size: S
risk: low
---

## User story
As a developer, I want every admin DTO to be a Zod schema first and a `createZodDto` class second, so that request validation, TypeScript types, and OpenAPI schemas all come from one source.

## Description
Establish the DTO authoring convention from §5.4 and provide three representative DTOs: `CreateBucketDto` (request, strict, regex-validated bucket name), `BucketSummaryDto` + `ListBucketsResponseDto` (response composition), and `ListObjectsQueryDto` (query string with `z.coerce.number()`). DTOs in other Stories follow this pattern. Note: the global `ZodValidationPipe` and `patchNestjsSwagger()` wiring in `main.ts` belongs to EPIC-01; this Story only authors DTOs.

## Acceptance criteria
- [x] DTO files match the §5.4 pattern: `export const FooSchema = z.object({ ... })` then `export class FooDto extends createZodDto(FooSchema) {}`.
- [x] `CreateBucketSchema` is `.strict()` and enforces `BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/` with custom message `'bucket name must match S3 naming rules'`.
- [x] `CreateBucketSchema` provides defaults `versioning: 'disabled'`, `objectLock: false`, `region: 'us-east-1'`.
- [x] `BucketSummarySchema` includes `objectCount`, `sizeBytes` (`int().nonnegative()`), `versioning: enum('disabled','enabled','suspended')`, `createdAt: string().datetime()`.
- [x] `ListObjectsQuerySchema` uses `z.coerce.number().int().min(1).max(1000).default(100)` for `limit`.
- [x] All DTOs import `createZodDto` from `nestjs-zod`; `z` comes from `zod` — `nestjs-zod/z` was removed in nestjs-zod v5, so this criterion's `nestjs-zod/z` is N/A on the installed version.

## Tasks
- [TASK-1216] Author `CreateBucketDto` with strict schema
- [TASK-1217] Author `BucketSummaryDto` and `ListBucketsResponseDto`
- [TASK-1218] Author `ListObjectsQueryDto` with `z.coerce.number()`

## Test plan
- [TEST-0409] DTO schema unit spec

## Dependencies
- Blocks: [STORY-0409], [STORY-0410]
- Blocked by: [STORY-0400], [EPIC-01] (global `ZodValidationPipe` and `patchNestjsSwagger()`)

## References
- `docs/WHITEPAPER.md` §5.4 (lines 7145–7249)
- Interfaces produced: `CreateBucketDto`, `BucketSummaryDto`, `ListBucketsResponseDto`, `ListObjectsQueryDto`
