---
id: STORY-0115
title: Object lock configuration, retention, and legal hold
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As an S3 client, I want `GET/PUT /:bucket?object-lock` plus `GET/PUT /:bucket/:key+?retention` and `?legal-hold` wired, so that `aws s3api put-object-lock-configuration` / `put-object-retention` / `put-object-legal-hold` round-trip.

## Description
Realize the object-lock rows from §2.8.2 (lines 2532–2533) and §2.8.3 (lines 2559–2562). XML bodies: `<ObjectLockConfiguration>` for the bucket; `<Retention>` and `<LegalHold>` for the object endpoints.

## Acceptance criteria
- [ ] `PUT /:bucket?object-lock` persists the configuration via `BucketService`.
- [ ] `GET /:bucket?object-lock` returns the persisted document.
- [ ] `PUT /:bucket/:key+?retention` accepts `<Retention>` (Mode, RetainUntilDate).
- [ ] `GET /:bucket/:key+?retention` returns the persisted retention.
- [ ] `PUT /:bucket/:key+?legal-hold` accepts `<LegalHold><Status>ON|OFF</Status></LegalHold>`.
- [ ] `GET /:bucket/:key+?legal-hold` returns the persisted hold.

## Tasks
- [TASK-0355] Implement PutObjectLockConfiguration and GetObjectLockConfiguration
- [TASK-0356] Implement PutObjectRetention and GetObjectRetention
- [TASK-0357] Implement PutObjectLegalHold and GetObjectLegalHold

## Test plan
- [TEST-0127] Object Lock e2e
- [TEST-0128] Object Lock conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0102], [STORY-0103], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2532–2533), §2.8.3 (lines 2559–2562)
- Interfaces consumed: `BucketService`, `ObjectService` (EPIC-03), `XmlInterceptor`
