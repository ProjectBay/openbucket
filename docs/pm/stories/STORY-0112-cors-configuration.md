---
id: STORY-0112
title: Bucket CORS configuration operations
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As an S3 client, I want `GET/PUT/DELETE /:bucket?cors` to round-trip a `<CORSConfiguration>` XML document, so that `aws s3api put-bucket-cors` configures the rules that drive preflight responses (STORY-0117).

## Description
Realize the CORS configuration rows from §2.8.2 (lines 2518–2520). The XML body uses the `<CORSRule>` shape with `<AllowedOrigin>`, `<AllowedMethod>`, `<AllowedHeader>`, `<ExposeHeader>`, `<MaxAgeSeconds>`. The XML parser already hints these as arrays (§2.3.3 lines 1484–1497).

## Acceptance criteria
- [ ] `PUT /:bucket?cors` parses and persists the `<CORSConfiguration>` rules.
- [ ] `GET /:bucket?cors` returns the persisted configuration, or `NoSuchCORSConfiguration` if none.
- [ ] `DELETE /:bucket?cors` clears the configuration and returns 204.
- [ ] Stored configuration is consumed by STORY-0117's preflight handler.

## Tasks
- [TASK-0352] Implement PutBucketCors, GetBucketCors, DeleteBucketCors

## Test plan
- [TEST-0121] CORS configuration e2e
- [TEST-0122] CORS configuration conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0102], [STORY-0103], [STORY-0105], [EPIC-03]
- Blocks: [STORY-0117]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2518–2520), §2.3.3 (lines 1463–1511)
- Interfaces consumed: `BucketService` (EPIC-03), `XmlInterceptor`, `XmlParser`
