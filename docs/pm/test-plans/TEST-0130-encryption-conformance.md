---
id: TEST-0130
title: Encryption conformance (aws-cli)
covers: [STORY-0116]
status: backlog
level: conformance
---

## Goal
Verify bucket encryption via aws-cli.

## Setup
- OpenBucket container; aws-cli configured.

## Cases
1. `aws s3api put-bucket-encryption --bucket b --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'` → success.
2. `aws s3api get-bucket-encryption --bucket b` returns the persisted config.
3. `aws s3api delete-bucket-encryption --bucket b` → success.
4. `aws s3api put-bucket-encryption … SSEAlgorithm=aws:kms` → 400 `InvalidArgument`.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |

## Tooling
- Framework: aws-cli
- Runner: `nx run conformance:run --suite=encryption`

## Pass criteria
- [ ] All cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2529–2531)
