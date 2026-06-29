---
id: TASK-0334
title: Implement HeadObject route
story: STORY-0109
status: done
type: implementation
size: XS
---

## Description
Implement `HEAD /:bucket/:key+` (`HeadObject`) per §2.8.3.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (HEAD family)

## Implementation notes
- Route: `| HEAD | `/:bucket/:key+` | — | `HeadObject` | |` (§2.8.3 line 2549).
- Per §2.1.1 (lines 1197–1202): `@Head(':bucketOrKey/*')` / `@Head(':bucketOrKey')` calling `this.objects.headObject(req, res, bucket, key)`.
- HEAD must not write a body even on error (per §2.7 lines 2435–2440 — the exception filter handles this).
- Apply `@S3Operation('HeadObject')`.

## Acceptance criteria
- [ ] 200 with all S3 metadata headers (`Content-Length`, `Content-Type`, `ETag`, `Last-Modified`, `x-amz-meta-*`).
- [ ] No body, ever (success or error).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0115]
- Conformance: covered by [TEST-0116]

## Dependencies
- Blocked by: [TASK-0301], [TASK-0321], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.3 (line 2549), §2.1.1 (lines 1197–1202)
