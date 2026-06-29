---
id: TASK-0933
title: Write same-partNumber O_EXCL tolerance integration test
story: STORY-0312
status: done
type: implementation
size: S
---

## Description
Write an integration test that fires two concurrent UploadPart requests against the same `(uploadId, partNumber)`. Confirm neither throws `EEXIST`, the final `.part` file contains the second writer's bytes (rename(2) atomicity), and the `multipart_parts` row's ETag equals MD5 of the second writer's payload (last write wins per AWS semantics).

## Files to create / modify
- `apps/backend/test/concurrency.spec.ts` — new

## Implementation notes
- Use supertest to send two concurrent PUTs to `/<bucket>/<key>?uploadId=...&partNumber=1` with distinct payloads.
- Wait for both responses; both must be HTTP 200 with quoted MD5 ETags.
- Inspect the filesystem (`stat .../1.part`) and the `multipart_parts` row.
- Per §4.8: "Both stage to `<N>.part.tmp` — but `flags: 'wx'` (O_EXCL) means the second creates a *different* tmp file (we suffix a random nonce when we detect the collision)."

## Acceptance criteria
- [ ] Neither concurrent request fails with `EEXIST`.
- [ ] Both requests return HTTP 200.
- [ ] After both settle, the persisted `1.part` size matches the second writer's payload size.

## Test obligations
- Unit: this is part of [TEST-0317]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0918]

## References
- `docs/WHITEPAPER.md` §4.8 (lines 6183–6184, 6191–6199)
