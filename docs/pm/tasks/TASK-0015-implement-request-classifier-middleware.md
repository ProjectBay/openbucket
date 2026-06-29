---
id: TASK-0015
title: Implement RequestClassifierMiddleware class
story: STORY-0007
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/middleware/request-classifier.middleware.ts` exactly as in §1.5. Implement the four-branch decision tree (admin API, SPA, vhost S3, path-style S3), assign `ctx.receivedAt = Date.now()` first, and never throw — bucket-existence and key-validity checks belong to the controllers.

## Files to create / modify
- `apps/openbucket-backend/src/common/middleware/request-classifier.middleware.ts` — new

## Implementation notes
- Quote constants and signatures from §1.5 verbatim:
  ```ts
  const BUCKET_LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

  @Injectable()
  export class RequestClassifierMiddleware implements NestMiddleware {
    private readonly endpointSuffix: string | null;

    constructor(config: AppConfigService) {
      this.endpointSuffix = config.endpoint ? `.${config.endpoint.toLowerCase()}` : null;
    }

    use(req: Request, _res: Response, next: NextFunction): void { ... }
  }
  ```
- Decision tree from §1.5 (lines 387–394):
  1. `path === '/api/admin' || path.startsWith('/api/admin/')` → `kind='admin'`
  2. `path === '/admin' || path.startsWith('/admin/')` → `kind='spa'`
  3. vhost: `host.endsWith(this.endpointSuffix)` and label passes `BUCKET_LABEL`
  4. else path-style: `'/'` → `s3-service`; first segment is bucket
- The malformed-label fallthrough is intentional — comment from §1.5 line 449–451:
  ```
  // Looked like vhost but the label is malformed. Fall through to path style;
  // the S3 controller will produce the proper InvalidBucketName error.
  ```

## Acceptance criteria
- [ ] File matches §1.5 (lines 396–467) verbatim.
- [ ] `BUCKET_LABEL` regex is `/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/`.
- [ ] `ctx.receivedAt` is assigned to `Date.now()` before any return.
- [ ] No branch throws; malformed input falls through to path-style.

## Test obligations
- Unit: covered by [TEST-0007]
- E2E: covered by [TEST-0008]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0011], [TASK-0013], [TASK-0016], [TASK-0017], [TASK-0018], [TASK-0030]

## References
- `docs/WHITEPAPER.md` §1.5 (lines 396–467)
