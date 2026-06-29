---
id: TASK-0356
title: Implement object retention (GET/PUT ?retention)
story: STORY-0115
status: done
type: implementation
size: S
---

## Description
Implement per-object retention operations per §2.8.3.

## Files to create / modify
- `apps/backend/src/s3/controllers/object.controller.ts` — modify (PUT/GET families, `'retention' in q` branch)

## Implementation notes
- Routes (§2.8.3 lines 2559–2560):
  - `| GET  | `/:bucket/:key+` | `retention` | `GetObjectRetention` |`
  - `| PUT  | `/:bucket/:key+` | `retention` | `PutObjectRetention` |`
- Per §2.1.1 (lines 1172, 1189): branches `if ('retention' in q) return this.objects.{put,get}Retention(req, bucket, key);`.
- `PutObjectRetention` is in `XML_REQUEST_OPS` (§2.3.2 line 1382). Body: `<Retention><Mode>GOVERNANCE|COMPLIANCE</Mode><RetainUntilDate>…</RetainUntilDate></Retention>`.
- Apply `@S3Operation('GetObjectRetention' | 'PutObjectRetention')`.

## Acceptance criteria
- [ ] PUT persists retention via `ObjectService.setRetention(bucket, key, retention)`.
- [ ] GET returns the persisted document.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0127]
- Conformance: covered by [TEST-0128]

## Dependencies
- Blocked by: [TASK-0301], [STORY-0102], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2559–2560), §2.1.1 (lines 1172, 1189), §2.3.2 (line 1382)
