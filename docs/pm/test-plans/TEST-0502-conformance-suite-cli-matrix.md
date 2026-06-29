---
id: TEST-0502
title: Conformance suite — aws-cli, mc, s3cmd, AWS SDK matrix
covers: [STORY-0504, TASK-1540, TASK-1541, TASK-1542, TASK-1543, TASK-1544, TASK-1545, TASK-1546]
status: review
level: conformance
---

## Goal
Verify that the built OpenBucket image, exercised by four independent S3 clients (`@aws-sdk/client-s3`, `aws-cli`, `mc`, `s3cmd`), correctly executes the minimum-viable S3 lifecycle: bucket create, object put, object get with byte-equal payload, object delete. The matrix catches drift in path-style vs. virtual-host addressing, ETag formatting, SigV4 corner cases, and content-type negotiation that any single client would miss.

## Setup
- CI runner: `ubuntu-22.04`.
- Built image artifact `docker-image` downloaded from the `build-image` job and loaded via `docker load -i /tmp/openbucket.tar`.
- `awscli`, `s3cmd` installed via apt; `mc` installed from `https://dl.min.io/client/mc/release/linux-amd64/mc`.
- Node 22, `npm ci` complete.
- `OPENBUCKET_IMAGE=openbucket:${{ needs.build-image.outputs.image-tag }}`.

## Cases
1. **SDK roundtrip ([TASK-1541]).** Given the container booted via `testcontainers` (`Wait.forHttp('/api/admin/health', 9000).forStatusCode(200)`, `startupTimeout: 60_000`), when the suite PUTs a 4 MiB random buffer, GETs it back, and compares bytes, then `downloaded.equals(body) === true`, `put.ETag` matches `^"[0-9a-f]{32}"$`, and `get.ETag === put.ETag`.
2. **aws-cli matrix ([TASK-1542]).** Given the same container, when the suite shells out to `aws --endpoint-url=... s3api create-bucket`, `aws s3 cp` (put and get), `aws s3 rm` against a 1 MiB fixture, then each binary call exits 0 and the round-tripped file matches the original.
3. **mc matrix ([TASK-1543]).** Given the same container, when the suite configures `mc alias set ob ...`, then runs `mc mb`, `mc cp`, `mc cat`, `mc rm`, then each call exits 0 and the round-tripped file matches.
4. **s3cmd matrix ([TASK-1544]).** Given the same container and a temp `.s3cfg` pointing at the mapped port, when the suite runs `s3cmd mb`, `s3cmd put`, `s3cmd get`, `s3cmd del`, then each call exits 0 and the round-tripped file matches.
5. **Gating.** Given a push to `main` (not a PR or tag), when CI runs, then the conformance job is skipped (per the `if:` guard).
6. **Gating positive.** Given a PR to `main` or a `refs/tags/*` push, when CI runs, then the conformance job runs and gates the overall workflow.

## Tooling
- Framework: jest with `*.conformance.ts` testMatch; `testcontainers`; `@aws-sdk/client-s3` for case 1; `node:child_process.execFile` for cases 2–4.
- Runner: `nx run conformance:e2e --ci` (locally and in the `conformance` CI job).
- CI job: `conformance` (see [TASK-1545]).

## Pass criteria
- [ ] Cases 1–4 all green on a PR run against the just-built image.
- [ ] Case 5: the `conformance` job is absent from a push-to-main run's job graph.
- [ ] Case 6: the `conformance` job appears in PR and tag runs and its red status fails the workflow.
- [ ] Each binary's stderr surfaces in Jest failure messages (no silent client errors).

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8699–8735), §5.20.3 (lines 8875–8946)
