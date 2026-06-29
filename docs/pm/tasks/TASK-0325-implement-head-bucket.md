---
id: TASK-0325
title: Implement HeadBucket
story: STORY-0108
status: done
type: implementation
size: XS
---

## Description
Implement `HEAD /:bucket` (`HeadBucket`).

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| HEAD | `/:bucket` | — | `HeadBucket` | 200 if exists+authorized, else `NoSuchBucket`. |` (§2.8.2 line 2507).
- HEAD returns no body even on error (per §2.7 line 2436 "AWS parity").

## Acceptance criteria
- [ ] Existing bucket → 200 with no body.
- [ ] Missing bucket → 404 with no body.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [TASK-0321], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2507), §2.7 (lines 2435–2440)
