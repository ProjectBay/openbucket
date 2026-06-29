---
id: TEST-0118
title: Multipart conformance (aws-cli / mc)
covers: [STORY-0110]
status: backlog
level: conformance
---

## Goal
Verify multipart upload with the reference clients.

## Setup
- OpenBucket container; aws-cli configured with `s3.multipart_threshold=5MB` to force multipart.

## Cases
1. `aws s3 cp ./100MB.bin s3://b/big --endpoint-url … --no-payload-signing` succeeds (forces multipart); `aws s3 cp s3://b/big ./out` retrieves bytes; checksums match.
2. `aws s3api list-multipart-uploads --bucket b` returns the in-flight upload during a long cp.
3. `aws s3api abort-multipart-upload --bucket b --key big --upload-id …` cleans up.
4. `mc cp ./100MB.bin local/b/big` (multipart) succeeds.

## Client matrix
| Client | Version | Notes |
|---|---|---|
| aws-cli | v2 | required, with `--no-payload-signing` |
| mc | latest | uses unsigned-payload by default |

## Tooling
- Framework: aws-cli + mc
- Runner: `nx run conformance:run --suite=multipart`

## Pass criteria
- [ ] All cases pass.

## References
- `docs/WHITEPAPER.md` §2.8.4 (lines 2565–2575), §2.4.6 (lines 1975–1981)
