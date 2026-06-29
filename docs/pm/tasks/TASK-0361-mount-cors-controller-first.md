---
id: TASK-0361
title: Mount CorsController before ObjectController in S3Module
story: STORY-0117
status: done
type: infra
size: XS
---

## Description
Ensure `CorsController` is declared **before** `ObjectController` in `S3Module.controllers` so that OPTIONS verbs hit the preflight handler.

## Files to create / modify
- `apps/backend/src/s3/s3.module.ts` — modify

## Implementation notes
- Per §2.9 (lines 2682–2685): "The classifier middleware sets `req.openbucket.kind = 's3'` for OPTIONS routes that fall through to the bucket prefix, and the S3 module's controller order places `CorsController` before `ObjectController` so that the OPTIONS verb is captured here."
- NestJS resolves controllers in registration order — `CorsController` first.

## Acceptance criteria
- [ ] `OPTIONS /:bucket/:key*` hits `CorsController.preflight`, not `ObjectController`.
- [ ] e2e test in TEST-0132 confirms ordering.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0132]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0300], [TASK-0359]

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2681–2685)
