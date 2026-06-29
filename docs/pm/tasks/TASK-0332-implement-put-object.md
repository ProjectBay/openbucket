---
id: TASK-0332
title: Implement PutObject route
story: STORY-0109
status: done
type: implementation
size: M
---

## Description
Implement `PUT /:bucket/:key+` (`PutObject`) per §2.8.3. Body streaming is owned by EPIC-04; this Task wires the dispatch branch in `ObjectController.put` to `ObjectService.putObject`.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PutObject branch already scaffolded in TASK-0301)

## Implementation notes
- Route: `| PUT  | `/:bucket/:key+` | — | `PutObject` | Body is the object. |` (§2.8.3 line 2546).
- Per §2.1.1 (line 1177): `return this.objects.putObject(req, res, bucket, key);` (terminal branch after all query+header tests).
- Apply `@S3Operation('PutObject')`.
- Streaming pipe primitive provided by EPIC-04 — handler delegates without buffering.

## Acceptance criteria
- [ ] `PUT /b/k` with body persists via `ObjectService.putObject`.
- [ ] Response includes ETag header equal to `MD5(payload)` (single-PUT).
- [ ] `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` is rejected upstream by SigV4Guard (TASK-0315).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0103], [EPIC-03], [EPIC-04]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2546), §2.1.1 (lines 1156–1178)
