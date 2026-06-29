---
id: TEST-0409
title: DTO schema unit spec
covers: [STORY-0408, TASK-1208, TASK-1213, TASK-1216, TASK-1217, TASK-1218, TASK-1224, TASK-1229, TASK-1236]
status: done
level: unit
---

## Goal
Verify that the representative nestjs-zod schemas accept valid input, reject invalid input, apply defaults, and reject unknown keys when `.strict()`.

## Setup
- Import each schema directly and exercise `.safeParse` / `.parse`.

## Cases
1. `CreateBucketSchema.parse({ name: 'valid-bucket' })` returns object with defaults `versioning: 'disabled'`, `objectLock: false`, `region: 'us-east-1'`.
2. `CreateBucketSchema.safeParse({ name: 'A' })` fails (uppercase + too short).
3. `CreateBucketSchema.safeParse({ name: 'ok', extra: true })` fails (`.strict()` rejects unknown keys).
4. `CreateBucketSchema.safeParse({ name: '-bad' })` fails (leading hyphen violates regex).
5. `BucketSummarySchema.safeParse({ ...validShape, versioning: 'suspended' })` succeeds (response enum includes `'suspended'`).
6. `ListObjectsQuerySchema.parse({ limit: '50' })` returns `{ limit: 50 }` (coerced via `z.coerce.number()`).
7. `ListObjectsQuerySchema.safeParse({ limit: 1500 })` fails (>1000).
8. `UpdateKeySchema.safeParse({})` fails with message `'at least one field required'`.
9. `LoginSchema.safeParse({ username: '', password: '' })` fails (`min(1)` on both).
10. `ChangePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' })` fails (`newPassword` minLen 12).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=dto-schemas.spec.ts`

## Pass criteria
- [ ] All ten cases pass.

## References
- `docs/WHITEPAPER.md` §5.4 (lines 7145–7249), §5.7 (lines 7558–7582), §5.8 (lines 7670–7691)
