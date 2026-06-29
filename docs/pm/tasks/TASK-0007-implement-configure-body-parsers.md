---
id: TASK-0007
title: Implement configureBodyParsers helper
story: STORY-0003
status: done
type: implementation
size: XS
---

## Description
Author `apps/backend/src/bootstrap/body-parser.ts` containing the helper exactly as specified in §1.2.2. Mount Express's JSON and url-encoded parsers on `/api/admin` only, leaving every other route unparsed so that S3 PUTs can stream `req`.

## Files to create / modify
- `apps/openbucket-backend/src/bootstrap/body-parser.ts` — new

## Implementation notes
- Quote §1.2.2 (lines 209–224) verbatim:
  ```ts
  import { type Express, json, urlencoded } from 'express';

  export function configureBodyParsers(app: Express): void {
    const adminJson = json({ limit: '1mb', strict: true });
    const adminForm = urlencoded({ limit: '1mb', extended: false });

    app.use('/api/admin', adminJson);
    app.use('/api/admin', adminForm);
  }
  ```
- Both limit constants are `'1mb'`; the JSON parser is `strict: true`; the form parser is `extended: false`.

## Acceptance criteria
- [ ] `configureBodyParsers` exported with signature `(app: Express) => void`.
- [ ] JSON and url-encoded parsers mounted only under `/api/admin`.
- [ ] No other paths are mounted with body parsers.

## Test obligations
- Unit: covered by [TEST-0003]
- E2E: N/A — exercised indirectly by STORY-0007/0012 e2e
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.2.2 (lines 209–224)
