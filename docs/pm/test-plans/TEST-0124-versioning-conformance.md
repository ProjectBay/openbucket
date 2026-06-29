---
id: TEST-0124
title: Versioning conformance (aws-cli)
covers: [STORY-0113]
status: backlog
level: conformance
---

## Goal
Verify bucket versioning via aws-cli.

## Setup
- OpenBucket container; aws-cli configured.

## Cases
1. `aws s3api put-bucket-versioning --bucket b --versioning-configuration Status=Enabled` → success.
2. `aws s3api get-bucket-versioning --bucket b` → `{"Status": "Enabled"}`.
3. `aws s3api put-bucket-versioning --bucket b --versioning-configuration Status=Suspended` then `get-bucket-versioning` → `Suspended`.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |

## Tooling
- Framework: aws-cli
- Runner: `nx run conformance:run --suite=versioning`

## Pass criteria
- [ ] All cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2521–2522)
