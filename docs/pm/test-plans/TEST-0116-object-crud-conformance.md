---
id: TEST-0116
title: Object CRUD conformance (aws-cli / mc / s3cmd)
covers: [STORY-0109]
status: backlog
level: conformance
---

## Goal
Verify object CRUD with reference clients.

## Setup
- OpenBucket container; clients configured.

## Cases
1. `aws s3 cp ./file s3://b/k --endpoint-url … --no-payload-signing` succeeds; `aws s3 cp s3://b/k ./out` retrieves bytes; checksums match.
2. `aws s3api head-object --bucket b --key k` returns metadata.
3. `aws s3 rm s3://b/k` deletes.
4. `aws s3 cp s3://b/k s3://b/k2 --metadata-directive COPY` copies; ETag stable.
5. `mc cp ./file local/b/k` succeeds; `mc cp local/b/k ./out` succeeds.
6. `s3cmd put ./file s3://b/k` succeeds; `s3cmd get s3://b/k ./out` succeeds.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | `--no-payload-signing` required for chunked-default cp |
| mc | latest | uses unsigned-payload |
| s3cmd | 2.x | uses UNSIGNED-PAYLOAD by default |

## Tooling
- Framework: aws-cli + mc + s3cmd
- Runner: `nx run conformance:run --suite=object-crud`

## Pass criteria
- [ ] All listed cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.3 (lines 2542–2563), §2.4.6 (lines 1975–1981)
