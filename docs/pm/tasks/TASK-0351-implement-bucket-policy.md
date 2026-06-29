---
id: TASK-0351
title: Implement bucket policy (GET/PUT/DELETE ?policy)
story: STORY-0111
status: done
type: implementation
size: S
---

## Description
Implement bucket policy operations per §2.8.2.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- Routes (§2.8.2 lines 2515–2517):
  - `| GET  | `/:bucket` | `policy` | `GetBucketPolicy` | JSON body. |`
  - `| PUT  | `/:bucket` | `policy` | `PutBucketPolicy` | JSON body. |`
  - `| DELETE | `/:bucket` | `policy` | `DeleteBucketPolicy` |`
- Per §2.3.2 line 1378: `'PutBucketPolicy'` appears in `XML_REQUEST_OPS` but is annotated `// JSON, not XML — skipped by op-name match` — the interceptor only parses XML for names in the set, but the handler reads the raw body for JSON.
- Apply `@S3Operation('GetBucketPolicy' | 'PutBucketPolicy' | 'DeleteBucketPolicy')`.
- GET with no policy → `NoSuchBucketPolicyError`.

## Acceptance criteria
- [ ] PUT body is JSON; persisted via `BucketService.setPolicy(bucket, policyJson)`.
- [ ] GET returns the JSON body verbatim with `Content-Type: application/json`.
- [ ] DELETE clears and returns 204.
- [ ] Missing → 404 `NoSuchBucketPolicy`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0119]
- Conformance: covered by [TEST-0120]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2515–2517), §2.3.2 (line 1378)
