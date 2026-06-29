---
id: STORY-0114
title: Bucket lifecycle configuration operations
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As an S3 client, I want `GET/PUT/DELETE /:bucket?lifecycle` to round-trip a `<LifecycleConfiguration>` XML body, so that `aws s3api put-bucket-lifecycle-configuration` configures the rules consumed by the background tick.

## Description
Realize the lifecycle rows from §2.8.2 (lines 2523–2525). The XML body contains repeated `<Rule>` and within them repeated `<Transition>` / `<NoncurrentVersionTransition>` elements — already hinted as arrays by the XmlParser (§2.3.3).

## Acceptance criteria
- [ ] `PUT /:bucket?lifecycle` parses and persists `<LifecycleConfiguration>`.
- [ ] `GET /:bucket?lifecycle` returns the persisted document or `NoSuchLifecycleConfiguration`.
- [ ] `DELETE /:bucket?lifecycle` clears the configuration.

## Tasks
- [TASK-0354] Implement PutBucketLifecycleConfiguration, GetBucketLifecycleConfiguration, DeleteBucketLifecycle

## Test plan
- [TEST-0125] Lifecycle e2e
- [TEST-0126] Lifecycle conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0102], [STORY-0103], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2523–2525), §2.3.3 (lines 1483–1498)
- Interfaces consumed: `BucketService` (EPIC-03), `XmlInterceptor`, `XmlParser`
