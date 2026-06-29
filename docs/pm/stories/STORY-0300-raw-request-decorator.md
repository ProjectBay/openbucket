---
id: STORY-0300
title: RawReq decorator for unbuffered request streams
epic: EPIC-04
status: done
size: XS
risk: low
---

## User story
As a developer, I want a `@RawReq()` parameter decorator that returns the underlying `IncomingMessage` for streaming handlers, so that PUT and UploadPart can pipe the body to disk without `body-parser` consuming it first.

## Description
Provide `apps/backend/src/common/http/raw-request.decorator.ts` exporting a `RawReq` parameter decorator. The decorator returns the Node `IncomingMessage` from the Nest `ExecutionContext` and throws if `req.readableEnded` is true — that condition means an upstream middleware (body-parser, multer, etc.) consumed the stream and a streaming handler will hang. Global body parsing is already disabled (EPIC-01 §1.2); this Story formalizes the typed access pattern used by §4.1, §4.4.2.

## Acceptance criteria
- [ ] `RawReq` is exported from `apps/backend/src/common/http/raw-request.decorator.ts`.
- [ ] When invoked on a fresh request, returns the same `IncomingMessage` instance as `ctx.switchToHttp().getRequest()`.
- [ ] When `req.readableEnded` is `true`, the decorator throws an `Error` whose message contains `'RawReq: request stream already consumed.'`.
- [ ] `nx test backend --testPathPattern=raw-request.decorator.spec.ts` passes.

## Tasks
- [TASK-0900] Implement RawReq decorator with readableEnded guard
- [TASK-0901] Export RawReq from common HTTP barrel module

## Test plan
- [TEST-0300] RawReq decorator unit tests

## Dependencies
- Blocks: [STORY-0301], [STORY-0306]
- Blocked by: _none_ (Nest is wired by [EPIC-01])

## References
- `docs/WHITEPAPER.md` §4.1.1 (lines 5217–5248)
- Interfaces produced: `RawReq` parameter decorator
