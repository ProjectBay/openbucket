---
id: TEST-0120
title: Tagging / ACL / Policy conformance (aws-cli)
covers: [STORY-0111]
status: backlog
level: conformance
---

## Goal
Verify tagging, ACL, and policy operations via aws-cli.

## Setup
- OpenBucket container; aws-cli configured.

## Cases
1. `aws s3api put-bucket-tagging --bucket b --tagging '{"TagSet":[{"Key":"env","Value":"prod"}]}'` then `get-bucket-tagging` returns the same.
2. `aws s3api put-object-tagging --bucket b --key k --tagging …` → success; `get-object-tagging` returns the same.
3. `aws s3api put-bucket-acl --bucket b --acl private` → success.
4. `aws s3api put-bucket-policy --bucket b --policy file://policy.json` → success; `get-bucket-policy` returns the JSON.
5. `aws s3api delete-bucket-policy --bucket b` → success; `get-bucket-policy` → 404 `NoSuchBucketPolicy`.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required |

## Tooling
- Framework: aws-cli
- Runner: `nx run conformance:run --suite=tagging-acl-policy`

## Pass criteria
- [ ] All cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2513–2517, 2526–2528), §2.8.3 (lines 2553–2557)
