---
id: TASK-0906
title: Register PutObjectInterceptor as a provider in the S3 module
story: STORY-0301
status: done
type: infra
size: XS
---

## Description
Add `PutObjectInterceptor` to the providers list of the S3 object module so `@UseInterceptors(PutObjectInterceptor)` resolves through DI.

## Files to create / modify
- `apps/backend/src/s3/object/object.module.ts` — modify (add provider) OR create if not present
- `apps/backend/src/s3/s3.module.ts` — modify (ensure ObjectModule is imported)

## Implementation notes
- The interceptor receives `ConfigService` via constructor injection per §4.1.2.

## Acceptance criteria
- [ ] `PutObjectInterceptor` is exported from `object.module.ts` providers.
- [ ] `nx build backend` compiles.

## Test obligations
- Unit: covered by [TEST-0301]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0905]

## References
- `docs/WHITEPAPER.md` §4.1.2 (lines 5287–5289)
