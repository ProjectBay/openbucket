---
id: TEST-0128
title: Object Lock conformance (aws-cli)
covers: [STORY-0115]
status: backlog
level: conformance
---

## Goal
Verify object-lock operations via aws-cli.

## Setup
- OpenBucket container; aws-cli configured.

## Cases
1. `aws s3api put-object-lock-configuration --bucket b --object-lock-configuration file://lock.json` → success.
2. `aws s3api get-object-lock-configuration --bucket b` returns the persisted config.
3. `aws s3api put-object-retention --bucket b --key k --retention file://retention.json` → success.
4. `aws s3api get-object-retention --bucket b --key k` returns the persisted document.
5. `aws s3api put-object-legal-hold --bucket b --key k --legal-hold Status=ON` then `get-object-legal-hold` → `ON`.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |

## Tooling
- Framework: aws-cli
- Runner: `nx run conformance:run --suite=object-lock`

## Pass criteria
- [ ] All cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2532–2533), §2.8.3 (lines 2559–2562)
