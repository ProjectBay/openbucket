---
id: STORY-0113
title: Bucket versioning operations
epic: EPIC-02
status: done
size: S
risk: low
---

## User story
As an S3 client, I want `GET/PUT /:bucket?versioning` to round-trip a `<VersioningConfiguration>` XML body, so that I can enable/suspend versioning on a bucket via `aws s3api put-bucket-versioning`.

## Description
Realize the versioning rows from §2.8.2 (lines 2521–2522). PUT accepts `<VersioningConfiguration><Status>Enabled|Suspended</Status></VersioningConfiguration>`. GET returns the persisted state (empty document if never set).

## Acceptance criteria
- [ ] `PUT /:bucket?versioning` accepts `Enabled` and `Suspended` and persists via `BucketService`.
- [ ] `GET /:bucket?versioning` returns the current state.
- [ ] `MFA-Delete` is accepted and ignored (single-tenant root-only).

## Tasks
- [TASK-0353] Implement PutBucketVersioning and GetBucketVersioning

## Test plan
- [TEST-0123] Versioning e2e
- [TEST-0124] Versioning conformance (aws-cli)

## Dependencies
- Blocked by: [STORY-0102], [STORY-0103], [STORY-0105], [EPIC-03]

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2521–2522)
- Interfaces consumed: `BucketService` (EPIC-03), `XmlInterceptor`
