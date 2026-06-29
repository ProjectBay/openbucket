---
id: TASK-0025
title: Implement AdminExceptionFilter
story: STORY-0010
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/filters/admin-exception.filter.ts` per §1.6.2. Gate on `req.openbucket?.kind === 'admin'`, branch on `ZodValidationException`, `HttpException`, and the unknown-error case. Every response body includes `requestId`.

## Files to create / modify
- `apps/openbucket-backend/src/common/filters/admin-exception.filter.ts` — new

## Implementation notes
- Quote §1.6.2 (lines 652–697) verbatim:
  ```ts
  @Catch()
  export class AdminExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(AdminExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
      const http = host.switchToHttp();
      const req = http.getRequest<Request>();
      const res = http.getResponse<Response>();

      if (req.openbucket?.kind !== 'admin') {
        throw exception;
      }

      const requestId = req.openbucket.requestId;

      if (exception instanceof ZodValidationException) {
        res.status(400).json({
          error: 'ValidationFailed',
          message: 'Request payload failed validation.',
          issues: exception.getZodError().issues,
          requestId,
        });
        return;
      }

      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const body = exception.getResponse();
        const payload = typeof body === 'string' ? { error: body } : (body as Record<string, unknown>);
        res.status(status).json({ ...payload, requestId });
        return;
      }

      this.logger.error({ err: exception, requestId }, 'Admin 5xx');
      res.status(500).json({
        error: 'InternalError',
        message: 'An unexpected error occurred.',
        requestId,
      });
    }
  }
  ```

## Acceptance criteria
- [ ] File matches the verbatim quote.
- [ ] `ZodValidationException` → 400 with `{ error: 'ValidationFailed', message, issues, requestId }`.
- [ ] `HttpException` body merged with `{ requestId }` and status preserved.
- [ ] Unknown error → 500 `{ error: 'InternalError', message, requestId }` and `Logger.error` line.

## Test obligations
- Unit: covered by [TEST-0011]
- E2E: N/A — exercised by STORY-0012 e2e (ServiceUnavailableException path)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0011]

## References
- `docs/WHITEPAPER.md` §1.6.2 (lines 652–697)
