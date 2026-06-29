---
id: TASK-0330
title: Implement bucket stub endpoints (replication, notification, accelerate, logging, requestPayment, website)
story: STORY-0108
status: done
type: implementation
size: S
---

## Description
Implement the bucket-scope stub endpoints per §2.8.2 notes column.

## Files to create / modify
- `apps/backend/src/s3/controllers/bucket.controller.ts` — modify

## Implementation notes
- §2.8.2 verbatim notes (lines 2534–2539):
  - `| GET  | `/:bucket` | `replication` | `GetBucketReplication` | Returns `ReplicationConfigurationNotFoundError`. |`
  - `| GET  | `/:bucket` | `notification` | `GetBucketNotificationConfiguration` | Returns empty doc; PUT is `NotImplemented` in v1. |`
  - `| GET  | `/:bucket` | `accelerate` | `GetBucketAccelerateConfiguration` | Returns `Suspended`. |`
  - `| GET  | `/:bucket` | `logging` | `GetBucketLogging` | Returns empty doc. |`
  - `| GET  | `/:bucket` | `requestPayment` | `GetBucketRequestPayment` | Returns `BucketOwner`. |`
  - `| GET  | `/:bucket` | `website` | `GetBucketWebsite` | `NotImplemented`. |`
- Returns:
  - replication: `<Error><Code>ReplicationConfigurationNotFoundError</Code>…` (404).
  - notification: empty `<NotificationConfiguration/>` with the XML namespace.
  - accelerate: `<AccelerateConfiguration><Status>Suspended</Status></AccelerateConfiguration>`.
  - logging: empty `<BucketLoggingStatus/>`.
  - requestPayment: `<RequestPaymentConfiguration><Payer>BucketOwner</Payer></RequestPaymentConfiguration>`.
  - website (GET and PUT): throw `NotImplementedError('GetBucketWebsite')` / `NotImplementedError('PutBucketWebsite')`.
  - PUT notification: throw `NotImplementedError('PutBucketNotificationConfiguration')`.

## Acceptance criteria
- [ ] Each stub returns the documented payload or `NotImplemented`.
- [ ] `aws s3api get-bucket-accelerate-configuration --bucket b` returns `Status: Suspended`.

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0113]
- Conformance: covered by [TEST-0114]

## Dependencies
- Blocked by: [TASK-0302], [STORY-0102], [STORY-0105]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2534–2539)
