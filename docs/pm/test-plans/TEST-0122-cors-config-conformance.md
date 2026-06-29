---
id: TEST-0122
title: CORS configuration conformance (aws-cli)
covers: [STORY-0112]
status: backlog
level: conformance
---

## Goal
Verify CORS configuration via aws-cli.

## Setup
- OpenBucket container; aws-cli configured.

## Cases
1. `aws s3api put-bucket-cors --bucket b --cors-configuration file://cors.json` → success.
2. `aws s3api get-bucket-cors --bucket b` returns the persisted CORSRules.
3. `aws s3api delete-bucket-cors --bucket b` → success.
4. After delete, `aws s3api get-bucket-cors --bucket b` → `NoSuchCORSConfiguration`.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |

## Tooling
- Framework: aws-cli
- Runner: `nx run conformance:run --suite=cors-config`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2518–2520)
