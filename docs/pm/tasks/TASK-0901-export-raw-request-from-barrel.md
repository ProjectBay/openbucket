---
id: TASK-0901
title: Export RawReq from common HTTP barrel module
story: STORY-0300
status: done
type: implementation
size: XS
---

## Description
Re-export `RawReq` from `apps/backend/src/common/http/index.ts` so consumers can import via the barrel instead of the concrete filename.

## Files to create / modify
- `apps/backend/src/common/http/index.ts` — modify (add `export * from './raw-request.decorator';`)

## Implementation notes
- The barrel is the canonical import surface for everything under `common/http/` per §1.1 of the architecture doc.

## Acceptance criteria
- [ ] `import { RawReq } from '../../common/http';` resolves from a sibling module.

## Test obligations
- Unit: covered by [TEST-0300]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0900]

## References
- `docs/WHITEPAPER.md` §4.1.1 (lines 5217–5248)
