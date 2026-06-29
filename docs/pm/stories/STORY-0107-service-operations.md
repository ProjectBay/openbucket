---
id: STORY-0107
title: Service-scope operations (ListBuckets)
epic: EPIC-02
status: done
size: XS
risk: low
---

## User story
As an S3 client, I want `GET /` to return `<ListAllMyBucketsResult>` listing every bucket I own, so that `aws s3 ls` and equivalent commands work.

## Description
Realize the service row of §2.8.1 (line 2499). The `ServiceController` handles the root verb `GET /` only (everything else is delegated to bucket/object controllers). The handler returns a POJO with `__root: 'ListAllMyBucketsResult'` which the `XmlInterceptor` envelopes.

## Acceptance criteria
- [ ] `GET /` is authenticated by `SigV4Guard` and authorized for the single root access key.
- [ ] Response body matches AWS `ListAllMyBucketsResult` shape with `Owner` and `Buckets/Bucket[]`.
- [ ] `aws s3 ls --endpoint-url http://localhost:9000` lists created buckets.

## Tasks
- [TASK-0322] Implement ListBuckets handler

## Test plan
- [TEST-0111] Service ops e2e
- [TEST-0112] Service ops conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0100], [STORY-0102], [STORY-0103], [STORY-0106], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.1 (lines 2495–2499)
- Interfaces consumed: `BucketService` (defined in EPIC-03), `XmlInterceptor` (defined in STORY-0102), `SigV4Guard` (defined in STORY-0103)
