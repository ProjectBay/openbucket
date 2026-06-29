---
id: TASK-0929
title: Audit and pin highWaterMark constants in interceptor, GET handler, and UploadPart handler
story: STORY-0311
status: done
type: refactor
size: XS
---

## Description
Verify that all three streaming sites use the explicit constant `256 * 1024` for `highWaterMark`. Extract the value to a shared constant in `apps/backend/src/s3/object/streaming.constants.ts` so future drift is caught by import.

## Files to create / modify
- `apps/backend/src/s3/object/streaming.constants.ts` — new (`export const STREAM_HIGH_WATER_MARK_BYTES = 256 * 1024;`)
- `apps/backend/src/s3/object/put-object.interceptor.ts` — modify (use constant)
- `apps/backend/src/s3/object/get-object.handler.ts` — modify (use constant)
- `apps/backend/src/s3/multipart/upload-part.handler.ts` — modify (use constant)

## Implementation notes
- Per §4.7: "256KB highWaterMark — see §4.7. Smaller than the kernel page cache working set, larger than a single TCP MSS, so we batch but don't pool."
- The constant must equal `256 * 1024` exactly.
- `BlobStore`'s internal write-stream hwm is owned by EPIC-03 — note (do not change) it here.

## Acceptance criteria
- [ ] `STREAM_HIGH_WATER_MARK_BYTES === 256 * 1024`.
- [ ] All three sites import and use the constant (verified by Grep search).

## Test obligations
- Unit: covered by [TEST-0316]
- E2E: N/A — pure infra
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0904], [TASK-0911], [TASK-0917]

## References
- `docs/WHITEPAPER.md` §4.7 (lines 6159–6163)
