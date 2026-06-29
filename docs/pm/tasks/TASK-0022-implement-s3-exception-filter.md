---
id: TASK-0022
title: Implement S3ExceptionFilter class
story: STORY-0009
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/filters/s3-exception.filter.ts` per §1.6.1. The filter is `@Catch()` (catch-all by design); it re-throws non-S3 requests, maps known exception classes via `mapToS3Shape`, sets the XML response, and logs 5xx via `Logger.error`.

## Files to create / modify
- `apps/openbucket-backend/src/common/filters/s3-exception.filter.ts` — new

## Implementation notes
- Quote signature from §1.6.1 (lines 582–623):
  ```ts
  @Catch()
  export class S3ExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(S3ExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
      const http = host.switchToHttp();
      const req = http.getRequest<Request>();
      const res = http.getResponse<Response>();
      if (req.openbucket?.kind !== 's3') {
        throw exception;
      }
      const { status, code, message } = mapToS3Shape(exception);
      const bucket = req.openbucket.bucket ?? '';
      const key = req.openbucket.key ?? '';
      const requestId = req.openbucket.requestId;
      const xml = ...; // see TASK-0023
      if (status >= 500) {
        this.logger.error({ err: exception, requestId, code }, 'S3 5xx');
      }
      res.status(status);
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('x-amz-request-id', requestId);
      res.send(xml);
    }
  }
  ```
- The placeholder XML body is the minimum SDK-acceptable shape per §1.6.1 (lines 604–612).

## Acceptance criteria
- [ ] Filter is `@Catch()`.
- [ ] Re-throws when `req.openbucket?.kind !== 's3'`.
- [ ] Sets `Content-Type: application/xml` and `x-amz-request-id` headers.
- [ ] 5xx responses log via `Logger.error` with `{ err, requestId, code }`.

## Test obligations
- Unit: covered by [TEST-0010]
- E2E: N/A — exercised once EPIC-02 lands
- Conformance: N/A — EPIC-02 owns conformance

## Dependencies
- Blocked by: [TASK-0011], [TASK-0023], [TASK-0024]

## References
- `docs/WHITEPAPER.md` §1.6.1 (lines 575–623)
