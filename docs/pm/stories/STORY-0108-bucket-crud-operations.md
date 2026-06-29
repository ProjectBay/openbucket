---
id: STORY-0108
title: Bucket CRUD and listing operations
epic: EPIC-02
status: done
size: M
risk: medium
---

## User story
As an S3 client, I want the full bucket-scope operation surface — `CreateBucket`, `DeleteBucket`, `HeadBucket`, `ListObjectsV1`, `ListObjectVersions`, `ListMultipartUploads`, `GetBucketLocation`, `DeleteObjects` (bulk), plus the stubbed `replication`/`notification`/`accelerate`/`logging`/`requestPayment`/`website` query rows — so that aws-cli, mc, and s3cmd can manage buckets.

## Description
Realize the bucket rows from §2.8.2 (lines 2501–2540) that are *not* covered by Tagging/ACL/Policy (STORY-0111), CORS (STORY-0112), Versioning (STORY-0113), Lifecycle (STORY-0114), Object-Lock (STORY-0115), or Encryption (STORY-0116). `ListObjectsV2` is owned by STORY-0118.

## Acceptance criteria
- [ ] `PUT /:bucket` (`CreateBucket`) creates a row and accepts the optional `<CreateBucketConfiguration>` XML body.
- [ ] `DELETE /:bucket` (`DeleteBucket`) rejects non-empty buckets with `BucketNotEmpty`.
- [ ] `HEAD /:bucket` (`HeadBucket`) returns 200 / 404 / 403 per §2.8.2.
- [ ] `GET /:bucket` (no `list-type=2`) returns `ListObjectsV1` shape.
- [ ] `GET /:bucket?versions` returns `ListObjectVersions`.
- [ ] `GET /:bucket?uploads` returns `ListMultipartUploads`.
- [ ] `GET /:bucket?location` returns `<LocationConstraint>us-east-1</LocationConstraint>`.
- [ ] `POST /:bucket?delete` (`DeleteObjects`) accepts the XML `<Delete>` body and returns per-key results.
- [ ] Stub endpoints (`replication`, `notification`, `accelerate`, `logging`, `requestPayment`, `website`) respond per the §2.8.2 notes column.

## Tasks
- [TASK-0323] Implement CreateBucket
- [TASK-0324] Implement DeleteBucket
- [TASK-0325] Implement HeadBucket
- [TASK-0326] Implement GetBucketLocation
- [TASK-0327] Implement ListObjectsV1
- [TASK-0328] Implement ListObjectVersions
- [TASK-0329] Implement ListMultipartUploads (bucket scope)
- [TASK-0330] Implement stub endpoints (replication, notification, accelerate, logging, requestPayment, website)
- [TASK-0331] Implement DeleteObjects (POST ?delete bulk)

## Test plan
- [TEST-0113] Bucket CRUD e2e
- [TEST-0114] Bucket CRUD conformance (aws-cli, mc, s3cmd)

## Dependencies
- Blocked by: [STORY-0100], [STORY-0102], [STORY-0103], [STORY-0106], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2501–2540)
- Interfaces consumed: `BucketService`, `ObjectService` (EPIC-03), `XmlInterceptor` (STORY-0102), `SigV4Guard` (STORY-0103)
