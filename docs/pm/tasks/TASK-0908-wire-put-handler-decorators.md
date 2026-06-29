---
id: TASK-0908
title: Wire @UseInterceptors(PutObjectInterceptor) and @RawReq on handler
story: STORY-0302
status: done
type: implementation
size: XS
---

## Description
Decorate `PutObjectHandler.handle` with `@UseInterceptors(PutObjectInterceptor)` and the parameter with `@RawReq() req: IncomingMessage` so the interceptor fires before the handler and the raw request stream is available.

## Files to create / modify
- `apps/backend/src/s3/object/put-object.handler.ts` — modify

## Implementation notes
- Method signature verbatim:
  ```ts
  @Put(':bucket/:key(*)')
  @UseInterceptors(PutObjectInterceptor)
  @HttpCode(200)
  async handle(
    @Param('bucket') bucket: string,
    @Param('key') key: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('content-length') contentLength: string | undefined,
    @RawReq() req: IncomingMessage,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void>
  ```

## Acceptance criteria
- [ ] Decorator order is exactly: `@Put` → `@UseInterceptors(PutObjectInterceptor)` → `@HttpCode(200)`.
- [ ] Parameter list matches §4.1.3 verbatim.

## Test obligations
- Unit: covered by [TEST-0303]
- E2E: covered by [TEST-0304]
- Conformance: covered by [TEST-0302]

## Dependencies
- Blocked by: [TASK-0907]

## References
- `docs/WHITEPAPER.md` §4.1.3 (lines 5435–5445)
