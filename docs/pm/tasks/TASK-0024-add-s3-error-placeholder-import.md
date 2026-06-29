---
id: TASK-0024
title: Add S3Error placeholder import path
story: STORY-0009
status: done
type: infra
size: XS
---

## Description
Add a minimal placeholder for `S3Error` at `apps/backend/src/s3/errors/s3-error.ts` so that `S3ExceptionFilter` (TASK-0022) can `instanceof`-check it before EPIC-02 lands the canonical error table. The placeholder exposes `status: number`, `code: string`, `message: string`.

## Files to create / modify
- `apps/openbucket-backend/src/s3/errors/s3-error.ts` — new (placeholder; EPIC-02 will replace)

## Implementation notes
- §1.6.1 line 580: `import { S3Error } from '../../s3/errors/s3-error';   // owned by §3`
- Placeholder body (will be replaced by EPIC-02):
  ```ts
  export class S3Error extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      message?: string,
    ) {
      super(message ?? code);
    }
  }
  ```
- EPIC-02 owns the canonical S3 error-code → HTTP-status table. This Task creates only the import path so EPIC-01 compiles in isolation.

## Acceptance criteria
- [ ] File exists with the placeholder class.
- [ ] `S3ExceptionFilter` compiles against the import path.
- [ ] A note in the file comment marks it as owned by EPIC-02 going forward.

## Test obligations
- Unit: covered by [TEST-0010]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0002]

## References
- `docs/WHITEPAPER.md` §1.6.1 (lines 579–580)
