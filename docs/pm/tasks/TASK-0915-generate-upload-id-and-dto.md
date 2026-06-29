---
id: TASK-0915
title: Generate uploadId via randomUUID and return the DTO shape
story: STORY-0305
status: done
type: implementation
size: XS
---

## Description
Use `node:crypto.randomUUID()` to generate `uploadId` and return the `{ bucket, key, uploadId }` DTO whose XML envelope is rendered by EPIC-02.

## Files to create / modify
- `apps/backend/src/s3/multipart/initiate-multipart.handler.ts` — modify

## Implementation notes
- `randomUUID()` per §4.4.1.
- Quote §4.4.1: "The XML response shape is the S3 agent's concern; we return a structured value the controller turns into XML."

## Acceptance criteria
- [ ] `uploadId` matches the v4 UUID regex.
- [ ] Returned object has exactly the fields `{ bucket, key, uploadId }`.

## Test obligations
- Unit: covered by [TEST-0308]
- E2E: covered by [TEST-0309]
- Conformance: covered by [TEST-0310]

## Dependencies
- Blocked by: [TASK-0914]

## References
- `docs/WHITEPAPER.md` §4.4.1 (lines 5751–5763)
