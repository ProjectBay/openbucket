---
id: TASK-0014
title: Add uuid v7 dependency and import path
story: STORY-0006
status: done
type: infra
size: XS
---

## Description
Add `uuid` (≥ v9, which exports `v7`) to `package.json` dependencies and `@types/uuid` to devDependencies. Per §1.5 the import is `import { v7 as uuidv7 } from 'uuid'`.

## Files to create / modify
- `package.json` — modify (add `uuid` and `@types/uuid`)
- `package-lock.json` — regenerate

## Implementation notes
- §1.5 line 495: `import { v7 as uuidv7 } from 'uuid';`
- UUIDv7 is supported by `uuid` v9.0.0+ (`v7` named export).

## Acceptance criteria
- [ ] `uuid` is listed under `dependencies` at a version exposing `v7`.
- [ ] `@types/uuid` is listed under `devDependencies`.
- [ ] `npm install` succeeds and `uuid/v7` is importable.

## Test obligations
- Unit: covered by [TEST-0006]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §1.5 (lines 494–495, 521)
