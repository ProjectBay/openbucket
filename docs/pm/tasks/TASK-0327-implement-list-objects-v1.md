---
id: TASK-0327
title: Implement ListObjectsV1
story: STORY-0108
status: done
type: implementation
size: S
---

## Description
Implement `GET /:bucket` (no `list-type=2`) — the legacy `ListObjectsV1` endpoint per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| GET  | `/:bucket` | — | `ListObjectsV1` | Legacy. Kept for compatibility. |` (§2.8.2 line 2508).
- Per §2.10 lines 2810–2814: "ListObjectsV1 (no `list-type=2`) uses the same machinery but returns `Marker` / `NextMarker` instead of continuation tokens — those are *not* HMAC-protected because v1 marker is the last key itself, which clients already see."
- Reads `prefix`, `marker`, `delimiter`, `max-keys` query params; returns POJO with `__root: 'ListBucketResult'` and `Marker`/`NextMarker`/`Contents[]`/`CommonPrefixes[]`.

## Acceptance criteria
- [ ] Default `max-keys` 1000, cap 1000.
- [ ] `Marker` accepts the last key from the previous response.
- [ ] No HMAC sealing applied (v1 marker is the key itself).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2508), §2.10 (lines 2810–2814)
