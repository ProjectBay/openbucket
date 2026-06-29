---
id: TEST-0309
title: Multipart lifecycle e2e via supertest
covers: [STORY-0305, STORY-0306, STORY-0307, STORY-0308]
status: done
level: e2e
---

## Goal
Exercise the full Initiate → UploadPart × N → Complete → GET path (and a separate Abort branch) through the Nest pipeline with a real fs and `:memory:` SQLite.

## Setup
- Test Nest app with temp `dataDir`.
- Pre-create bucket.

## Cases
1. **Happy path 5 parts**: Initiate; UploadPart 1..5 (each 5 MiB except part 5 which is 1 KiB); Complete with the parts list; assert final ETag `<md5>-5` matches the multipart formula; GET the object and assert the bytes equal `concat(parts)`.
2. **Out-of-order UploadParts**: Upload parts in order `[3, 1, 5, 2, 4]`; assert all return 200; Complete still succeeds.
3. **Last part < 5 MiB allowed**: part 5 = 1 KiB; Complete succeeds.
4. **Middle part < 5 MiB rejected**: part 3 = 1 KiB → Complete returns 400 `EntityTooSmall`.
5. **Non-contiguous parts rejected**: Complete with `[1, 2, 4]` → 400 `InvalidPartOrder`.
6. **Wrong ETag rejected**: Complete with a mutated part-2 ETag → 400 `InvalidPart`.
7. **Missing part file rejected**: physically delete `2.part` from the staging dir before Complete → 400 `InvalidPart` 'Part file missing'.
8. **Abort branch**: Initiate; UploadPart 1; Abort; assert `<dataDir>/multipart/<uploadId>` no longer exists; subsequent UploadPart against the same `uploadId` → 404 `NoSuchUpload`.
9. **Late UploadPart after Complete**: Complete; then PUT a part against the same `uploadId` → 404 `NoSuchUpload`.

## Tooling
- Framework: supertest, jest
- Runner: `nx e2e backend-e2e --testPathPattern=multipart.e2e-spec.ts`

## Pass criteria
- [ ] All nine cases pass.

## References
- `docs/WHITEPAPER.md` §4.4 (lines 5720–6032)
