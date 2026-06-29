---
id: TASK-0018
title: Wire endpoint suffix from AppConfigService into classifier
story: STORY-0007
status: done
type: implementation
size: XS
---

## Description
In `RequestClassifierMiddleware`'s constructor, read `config.endpoint` once and stash `endpointSuffix` as `'.${endpoint.toLowerCase()}'` (or `null` when unset). The hot path never re-touches `ConfigService` — §1.5 line 415 calls this out explicitly.

## Files to create / modify
- `apps/openbucket-backend/src/common/middleware/request-classifier.middleware.ts` — modify

## Implementation notes
- Quote §1.5 (lines 411–417):
  ```ts
  private readonly endpointSuffix: string | null;

  constructor(config: AppConfigService) {
    // Stored once; the classifier hot path never touches ConfigService.
    this.endpointSuffix = config.endpoint ? `.${config.endpoint.toLowerCase()}` : null;
  }
  ```
- `config.endpoint` is `string | undefined` per §1.7 (`OPENBUCKET_ENDPOINT` is optional).

## Acceptance criteria
- [ ] When `OPENBUCKET_ENDPOINT='s3.example.com'`, `endpointSuffix === '.s3.example.com'`.
- [ ] When `OPENBUCKET_ENDPOINT` is unset, `endpointSuffix === null` and vhost branch is skipped.
- [ ] The classifier's `use(...)` does not import or call `ConfigService` directly.

## Test obligations
- Unit: covered by [TEST-0007]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0030]

## References
- `docs/WHITEPAPER.md` §1.5 (lines 411–417)
