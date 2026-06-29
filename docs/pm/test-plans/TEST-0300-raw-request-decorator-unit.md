---
id: TEST-0300
title: RawReq decorator unit tests
covers: [STORY-0300, TASK-0900, TASK-0901]
status: done
level: unit
---

## Goal
Verify `@RawReq()` returns the `IncomingMessage` and throws the documented error when the body stream has already been consumed.

## Setup
- Jest with no DOM env.
- Mock `ExecutionContext` returning a stub `IncomingMessage` with controllable `readableEnded`.

## Cases
1. Given a fresh `IncomingMessage` (`readableEnded === false`), when the decorator factory is invoked, then it returns the same instance.
2. Given a consumed `IncomingMessage` (`readableEnded === true`), when invoked, then it throws an `Error` whose message contains `'RawReq: request stream already consumed.'`.
3. Given the barrel export, when importing `{ RawReq } from '../../common/http'`, then the export resolves.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=raw-request.decorator.spec.ts`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §4.1.1 (lines 5217–5248)
