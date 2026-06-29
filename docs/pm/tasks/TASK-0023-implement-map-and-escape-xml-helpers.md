---
id: TASK-0023
title: Implement mapToS3Shape and escapeXml helpers
story: STORY-0009
status: done
type: implementation
size: XS
---

## Description
Implement the two private helpers used by `S3ExceptionFilter` per §1.6.1: `mapToS3Shape(exception): { status, code, message }` and `escapeXml(s): string`. The XML body uses the format:

```
<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>...</Code><Message>...</Message><Resource>...</Resource><RequestId>...</RequestId></Error>
```

## Files to create / modify
- `apps/openbucket-backend/src/common/filters/s3-exception.filter.ts` — modify

## Implementation notes
- Quote §1.6.1 (lines 625–646):
  ```ts
  function mapToS3Shape(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof S3Error) {
      return { status: exception.status, code: exception.code, message: exception.message };
    }
    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        code: 'InternalError',
        message: exception.message,
      };
    }
    return { status: 500, code: 'InternalError', message: 'We encountered an internal error.' };
  }

  function escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  ```
- The XML template from §1.6.1 (lines 605–612) uses single-line concatenation; preserve verbatim.

## Acceptance criteria
- [ ] `mapToS3Shape(new S3Error(...))` returns its `status`/`code`/`message`.
- [ ] `mapToS3Shape(new HttpException('x', 404))` returns `{ status: 404, code: 'InternalError', ... }`.
- [ ] Unknown exception defaults to `{ status: 500, code: 'InternalError', message: 'We encountered an internal error.' }`.
- [ ] `escapeXml('<&>"\'')` returns `'&lt;&amp;&gt;&quot;&apos;'`.

## Test obligations
- Unit: covered by [TEST-0010]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0024]

## References
- `docs/WHITEPAPER.md` §1.6.1 (lines 625–646)
