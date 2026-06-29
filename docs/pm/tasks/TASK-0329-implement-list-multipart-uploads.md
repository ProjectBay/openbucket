---
id: TASK-0329
title: Implement ListMultipartUploads (bucket scope)
story: STORY-0108
status: done
type: implementation
size: S
---

## Description
Implement `GET /:bucket?uploads` (`ListMultipartUploads`).

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Route: `| GET  | `/:bucket` | `uploads` | `ListMultipartUploads` | |` (§2.8.2 line 2511).
- Returns POJO with `__root: 'ListMultipartUploadsResult'` and `<Upload>` entries (UploadId, Key, Initiated, Initiator, Owner, StorageClass).
- Reads `prefix`, `key-marker`, `upload-id-marker`, `delimiter`, `max-uploads`.

## Acceptance criteria
- [ ] Pending multipart uploads returned across all keys in the bucket.
- [ ] Default `max-uploads` 1000.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0117]
- Conformance: covered by [TEST-0118]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (line 2511), §2.8.4 (line 2575)
