---
id: TEST-0114
title: Bucket CRUD conformance (aws-cli / mc / s3cmd)
covers: [STORY-0108, TASK-0323, TASK-0324, TASK-0325, TASK-0326, TASK-0327, TASK-0328, TASK-0329, TASK-0330, TASK-0331]
status: backlog
level: conformance
---

## Goal
Verify bucket CRUD with the three reference clients against the running container.

## Setup
- OpenBucket Docker image running; clients configured with fixture credentials.

## Cases
1. `aws s3 mb s3://b --endpoint-url …` succeeds; `aws s3api head-bucket --bucket b` → 200.
2. `aws s3 rb s3://b --endpoint-url …` succeeds.
3. `aws s3api get-bucket-location --bucket b` returns `us-east-1`.
4. `mc mb local/b` succeeds (where `local` is an alias to OpenBucket).
5. `s3cmd mb s3://b` succeeds; `s3cmd rb s3://b` succeeds.
6. `aws s3api delete-objects --bucket b --delete file://delete.json` deletes the listed keys.

## Client matrix
| Client | Version | Cases |
|---|---|---|
| aws-cli | v2 | 1, 2, 3, 6 |
| mc | latest | 4 |
| s3cmd | 2.x | 5 |

## Tooling
- Framework: aws-cli + mc + s3cmd (jest harness via child_process)
- Runner: `nx run conformance:run --suite=bucket-crud`

## Pass criteria
- [ ] All listed cases pass on their assigned client.

## References
- `docs/WHITEPAPER.md` §2.8.2 (lines 2501–2540)
