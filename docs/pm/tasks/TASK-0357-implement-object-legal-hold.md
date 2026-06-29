---
id: TASK-0357
title: Implement object legal hold (GET/PUT ?legal-hold)
story: STORY-0115
status: done
type: implementation
size: S
---

## Description
Implement per-object legal-hold operations per §2.8.3.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT/GET families, `'legal-hold' in q` branch)

## Implementation notes
- Routes (§2.8.3 lines 2561–2562):
  - `| GET  | `/:bucket/:key+` | `legal-hold` | `GetObjectLegalHold` |`
  - `| PUT  | `/:bucket/:key+` | `legal-hold` | `PutObjectLegalHold` |`
- Per §2.1.1 (lines 1173, 1190): branches `if ('legal-hold' in q) return this.objects.{put,get}LegalHold(req, bucket, key);`.
- `PutObjectLegalHold` is in `XML_REQUEST_OPS` (§2.3.2 line 1383? — actually line 1383 is `PutObjectLegalHold` per the set). Body: `<LegalHold><Status>ON|OFF</Status></LegalHold>`.
- Apply `@S3Operation('GetObjectLegalHold' | 'PutObjectLegalHold')`.

## Acceptance criteria
- [ ] PUT persists the hold via `ObjectService.setLegalHold(bucket, key, status)`.
- [ ] GET returns the persisted hold.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0127]
- Conformance: covered by [TEST-0128]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2561–2562), §2.1.1 (lines 1173, 1190), §2.3.2 (lines 1369–1385)
