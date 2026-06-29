---
id: TASK-1239
title: Implement AuditService and AuditEvent interface
story: STORY-0413
status: done
type: implementation
size: XS
---

## Description
Single-method service that emits a structured Pino log record with `audit: true` plus all caller-supplied fields.

## Files to create / modify
- `apps/backend/src/admin/audit/audit.service.ts` — new

## Implementation notes
- Verbatim from §5.9 (lines 7703–7722):
  ```ts
  export interface AuditEvent {
    event: string;
    subject: string;
    requestId?: string;
    [k: string]: unknown;
  }

  @Injectable()
  export class AuditService {
    private readonly logger = new Logger('admin.audit');

    emit(event: AuditEvent): void {
      // nestjs-pino flattens the second argument into the JSON record.
      this.logger.log({ ...event, audit: true });
    }
  }
  ```

## Acceptance criteria
- [ ] `AuditEvent` requires `event` and `subject`.
- [ ] `emit` produces a record containing every field plus `audit: true`.
- [ ] Logger context is `'admin.audit'`.

## Test obligations
- Unit: covered by [TEST-0418]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1201]

## References
- `docs/WHITEPAPER.md` §5.9 (lines 7699–7723)
