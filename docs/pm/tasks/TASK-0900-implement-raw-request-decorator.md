---
id: TASK-0900
title: Implement RawReq decorator with readableEnded guard
story: STORY-0300
status: done
type: implementation
size: XS
---

## Description
Create `apps/backend/src/common/http/raw-request.decorator.ts` exporting the `RawReq` parameter decorator that returns the underlying `IncomingMessage`. The decorator must throw if `req.readableEnded === true` because that means an upstream middleware already consumed the stream and a streaming handler would hang.

## Files to create / modify
- `apps/backend/src/common/http/raw-request.decorator.ts` — new

## Implementation notes
- Use `createParamDecorator((_data: unknown, ctx: ExecutionContext): IncomingMessage => ...)`.
- The guarded error message must read verbatim per §4.1.1:
  `'RawReq: request stream already consumed. ' +`
  `'Check that no upstream middleware (body-parser, multer, etc.) ' +`
  `'has been registered for this route.'`
- Return type is `IncomingMessage` from `node:http`.

## Acceptance criteria
- [ ] `RawReq` is a `createParamDecorator` factory that returns `IncomingMessage`.
- [ ] Throws an `Error` containing `'RawReq: request stream already consumed.'` when `req.readableEnded` is true.
- [ ] `nx lint backend` passes.

## Test obligations
- Unit: covered by [TEST-0300]
- E2E: N/A — pure infra
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §4.1.1 (lines 5217–5248)
