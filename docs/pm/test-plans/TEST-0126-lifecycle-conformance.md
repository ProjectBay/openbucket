---
id: TEST-0126
title: Lifecycle conformance (aws-cli)
covers: [STORY-0114]
status: backlog
level: conformance
---

## Goal
Verify lifecycle configuration via aws-cli.

## Setup
- OpenBucket container; aws-cli configured.

## Cases
1. `aws s3api put-bucket-lifecycle-configuration --bucket b --lifecycle-configuration file://lc.json` → success.
2. `aws s3api get-bucket-lifecycle-configuration --bucket b` returns the persisted rules.
3. `aws s3api delete-bucket-lifecycle --bucket b` → success.
4. `aws s3api get-bucket-lifecycle-configuration --bucket b` → `NoSuchLifecycleConfiguration`.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |

## Tooling
- Framework: aws-cli
- Runner: `nx run conformance:run --suite=lifecycle`

## Pass criteria
- [ ] All cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2523–2525)
