---
id: STORY-0111
title: Tagging, ACL, and Policy operations
epic: EPIC-02
status: done
size: M
risk: low
---

## User story
As an S3 client, I want bucket and object tagging, ACL (single-tenant always-owner-full), and bucket policy endpoints wired, so that `aws s3api put-bucket-tagging`, `put-object-tagging`, `put-bucket-acl`, and `put-bucket-policy` round-trip.

## Description
Realize the tagging, ACL, and policy rows from §2.8.2 (lines 2513–2517, 2526–2528) and §2.8.3 (lines 2553–2557). Tagging uses XML bodies; ACL is accepted but no-op beyond owner-full; bucket policy is JSON (skipped by the XML interceptor per §2.3.2 `XML_REQUEST_OPS` comment).

## Acceptance criteria
- [ ] `GET/PUT/DELETE /:bucket?tagging` round-trip a `<Tagging>` document.
- [ ] `GET/PUT/DELETE /:bucket/:key+?tagging` round-trip object tags.
- [ ] `GET/PUT /:bucket?acl` accept ACL XML; PUT is a no-op; GET returns owner-full.
- [ ] `GET/PUT /:bucket/:key+?acl` likewise for objects.
- [ ] `GET/PUT/DELETE /:bucket?policy` round-trip a JSON policy.
- [ ] Missing tag set surfaces `NoSuchTagSet`; missing policy surfaces `NoSuchBucketPolicy`.

## Tasks
- [TASK-0347] Implement bucket tagging (GET/PUT/DELETE ?tagging)
- [TASK-0348] Implement object tagging (GET/PUT/DELETE ?tagging)
- [TASK-0349] Implement bucket ACL (GET/PUT ?acl)
- [TASK-0350] Implement object ACL (GET/PUT ?acl)
- [TASK-0351] Implement bucket policy (GET/PUT/DELETE ?policy)

## Test plan
- [TEST-0119] Tagging/ACL/Policy e2e
- [TEST-0120] Tagging/ACL/Policy conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0100], [STORY-0102], [STORY-0103], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2513–2517, 2526–2528), §2.8.3 (lines 2553–2557)
- Interfaces consumed: `BucketService`, `ObjectService` (EPIC-03)
