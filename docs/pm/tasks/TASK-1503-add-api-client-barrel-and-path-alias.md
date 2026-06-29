---
id: TASK-1503
title: Add api-client barrel and tsconfig path alias
story: STORY-0500
status: done
type: infra
size: XS
---

## Description
Add `libs/api-client/src/index.ts` re-exporting the generated API surface, and a `@openbucket/api-client` path alias in `tsconfig.base.json` pointing at that barrel so consumers import from the package name only.

## Files to create / modify
- `libs/api-client/src/index.ts` — new
- `tsconfig.base.json` — modify (add `compilerOptions.paths["@openbucket/api-client"]`)

## Implementation notes
- Verbatim barrel from white paper §5.16.4:

  ```ts
  // libs/api-client/src/index.ts
  export * from './lib/api/api';
  export * from './lib/model/models';
  export * from './lib/configuration';
  ```

- Add path alias: `"@openbucket/api-client": ["libs/api-client/src/index.ts"]` under `compilerOptions.paths` in `tsconfig.base.json`. Consumers (SPA, e2e) import from the package name only.

## Acceptance criteria
- [ ] `import { Configuration } from '@openbucket/api-client'` resolves in TypeScript and at runtime.
- [ ] The barrel re-exports api, models, and configuration.

## Test obligations
- Unit: N/A — infra; resolution is exercised by SPA build in [EPIC-05].
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1502]

## References
- `docs/WHITEPAPER.md` §5.16.4 (lines 8439–8448)
