---
id: TASK-1250
title: Implement provideApiClient environment providers
story: STORY-0417
status: done
type: implementation
size: XS
---

## Description
Environment-provider factory for the generated `@openbucket/api-client`. Same-origin → empty `basePath`.

## Files to create / modify
- `apps/frontend/src/app/shared/api/api-client.providers.ts` — new

## Implementation notes
- Verbatim from §5.13 (lines 8074–8095):
  ```ts
  export function provideApiClient(): EnvironmentProviders {
    const params: ConfigurationParameters = {
      basePath: '', // same origin — admin SPA is served by the same backend
    };
    return makeEnvironmentProviders([
      { provide: Configuration, useValue: new Configuration(params) },
      BucketsService,
      ObjectsService,
      KeysService,
    ]);
  }
  ```

## Acceptance criteria
- [ ] `basePath` is the empty string.
- [ ] Three services provided: `BucketsService`, `ObjectsService`, `KeysService`.
- [ ] Wrapped by `makeEnvironmentProviders` so the result is an `EnvironmentProviders`.

## Test obligations
- Unit: covered by [TEST-0423]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1242], [EPIC-06] (`@openbucket/api-client` generated package)

## References
- `docs/WHITEPAPER.md` §5.13 (lines 8074–8095)
