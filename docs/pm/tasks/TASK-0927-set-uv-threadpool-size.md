---
id: TASK-0927
title: Set UV_THREADPOOL_SIZE default to 16 at top of main.ts
story: STORY-0310
status: done
type: implementation
size: XS
---

## Description
Place `process.env.UV_THREADPOOL_SIZE ??= '16';` as the first executable line in `apps/backend/src/main.ts`, before any `import` statement. libuv reads this env var once at process startup; setting it after the first async fs call has no effect.

## Files to create / modify
- `apps/backend/src/main.ts` — modify

## Implementation notes
- Verbatim per §4.6:
  ```ts
  // Must be the first line of executable code. Setting it after the first
  // async fs call has no effect — libuv has already sized the pool.
  process.env.UV_THREADPOOL_SIZE ??= '16';

  // Now imports may proceed.
  import { NestFactory } from '@nestjs/core';
  ```
- The `??=` operator preserves an externally-provided value, so operators can override via env without code changes.

## Acceptance criteria
- [ ] First non-comment executable statement of `main.ts` is `process.env.UV_THREADPOOL_SIZE ??= '16';`.
- [ ] No `import` statement appears above it.
- [ ] An external `UV_THREADPOOL_SIZE=8` env override is preserved.

## Test obligations
- Unit: covered by [TEST-0315]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.6 (lines 6114–6123)
