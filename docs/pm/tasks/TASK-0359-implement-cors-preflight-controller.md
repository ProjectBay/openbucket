---
id: TASK-0359
title: Implement CorsController preflight handler
story: STORY-0117
status: done
type: implementation
size: M
---

## Description
Implement `CorsController.preflight` per §2.9.

## Files to create / modify
- `apps/backend/src/s3/cors/cors.controller.ts` — new

## Implementation notes
- Verbatim from §2.9 (lines 2591–2661):
  ```ts
  @Controller()
  @UseFilters(S3ExceptionFilter)
  export class CorsController {
    constructor(
      private readonly buckets: BucketService,
      private readonly routes: RouteResolver,
    ) {}

    @Options(':bucketOrKey/*')
    @Options(':bucketOrKey')
    async preflight(@Req() req: Request, @Res() res: Response): Promise<void> { /* ... */ }
  }
  ```
- OPTIONS bypasses `SigV4Guard` per §2.9 line 2681.
- Non-CORS OPTIONS (no `Origin` and no `Access-Control-Request-Method`): respond `200` with `Allow: GET, HEAD, PUT, POST, DELETE, OPTIONS` per §2.9 line 2631.
- Missing bucket → `NoSuchBucketError(bucket)`; bucket without CORS config → `NoSuchCORSConfigurationError('CORSResponse: CORS is not enabled for this bucket.')` per §2.9 line 2639.
- Rule match (per §2.9 lines 2641–2645): origin matches by glob, method in `r.allowedMethods`, all requested headers match `r.allowedHeaders`.
- No matching rule → `AccessDeniedError('CORSResponse: This CORS request is not allowed.')` per §2.9 line 2646.
- Headers set (per §2.9 lines 2648–2659):
  - `Access-Control-Allow-Origin`: literal origin or `*` if rule allows `*`.
  - `Access-Control-Allow-Methods`: comma+space joined.
  - `Access-Control-Allow-Headers`: comma+space joined (if any).
  - `Access-Control-Expose-Headers`: comma+space joined (if any).
  - `Access-Control-Max-Age`: stringified `rule.maxAgeSeconds`.
  - `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`.

## Acceptance criteria
- [ ] All header behaviours from §2.9 lines 2629–2660 verified.
- [ ] OPTIONS not protected by SigV4Guard.

## Test obligations
- Unit: covered by [TEST-0131]
- E2E: covered by [TEST-0132]
- Conformance: covered by [TEST-0133]

## Dependencies
- Blocked by: [TASK-0300], [TASK-0307], [TASK-0321], [TASK-0360], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.9 (lines 2585–2685)
