---
id: TEST-0136
title: ListObjectsV2 conformance (aws-cli)
covers: [STORY-0118]
status: backlog
level: conformance
---

## Goal
Verify ListObjectsV2 pagination via aws-cli.

## Setup
- OpenBucket container; aws-cli configured. Pre-populate 2500 keys.

## Cases
1. `aws s3api list-objects-v2 --bucket b --max-keys 1000` returns the first page with `NextContinuationToken`.
2. `aws s3api list-objects-v2 --bucket b --continuation-token <token>` returns the next page.
3. `aws s3 ls s3://b --recursive` paginates internally and yields all 2500 keys (counted by `wc -l`).
4. `aws s3api list-objects-v2 --bucket b --prefix foo/ --max-keys 50` honours both filters.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |
| mc | latest | optional — `mc ls --recursive` |

## Tooling
- Framework: aws-cli + optional mc
- Runner: `nx run conformance:run --suite=list-objects-v2`

## Pass criteria
- [ ] All four cases pass; total returned key count equals 2500 in case 3.

## References
- `docs/WHITEPAPER.md` §2.10 (lines 2689–2814)
