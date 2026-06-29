---
id: TEST-0112
title: Service ops conformance (aws-cli)
covers: [STORY-0107, TASK-0322]
status: backlog
level: conformance
---

## Goal
Verify `aws s3 ls` against the running OpenBucket container.

## Setup
- Build and run the OpenBucket Docker image with a fixed access key pair.
- Configure `~/.aws/credentials` with the fixture key.
- Pre-create buckets `alpha`, `beta`.

## Cases
1. `aws s3 ls --endpoint-url http://localhost:9000` → lists `alpha` and `beta` with creation dates.
2. `aws --no-sign-request s3 ls --endpoint-url …` → 403 `AccessDenied`.

## Client matrix
| Client | Version | Status |
|---|---|---|
| aws-cli | v2 | required |
| mc | latest | optional |
| s3cmd | 2.x | optional |

## Tooling
- Framework: aws-cli (jest harness via `child_process.execSync`)
- Runner: `nx run conformance:run --suite=service-ops`

## Pass criteria
- [ ] aws-cli case 1 succeeds.
- [ ] aws-cli case 2 returns 403 with the documented error.

## References
- `docs/WHITEPAPER.md` §2.8.1 (lines 2495–2499)
