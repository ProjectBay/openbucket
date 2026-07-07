---
id: STORY-0504
title: CI S3 conformance suite (aws-cli, mc, s3cmd, AWS SDK)
epic: EPIC-06
status: done
size: L
risk: high
---

## User story
As a release manager, I want CI to spin the just-built OpenBucket image with `testcontainers` and exercise it against `aws-cli`, `mc`, `s3cmd`, and `@aws-sdk/client-s3`, so that any drift from S3 protocol semantics is caught by real-client behavior before merging to `main` or cutting a tag.

## Description
Add the `conformance` job from §5.19 and the supporting `apps/conformance` Nx project. The job is gated to `pull_request` events and `refs/tags/*` pushes, runs on `ubuntu-22.04` after `build-image`, installs `awscli` + `s3cmd` via apt and `mc` from the MinIO download, downloads the `docker-image` artifact, `docker load`s it, runs `npm ci`, and invokes `nx run conformance:e2e --ci` with `OPENBUCKET_IMAGE` pointing at the loaded image tag. The `apps/conformance` project hosts the AWS-SDK roundtrip sample (§5.20.3) plus a CLI-matrix subdirectory with one suite per binary.

## Acceptance criteria
- [ ] Job `conformance` exists with `if: github.event_name == 'pull_request' || startsWith(github.ref, 'refs/tags/')`.
- [ ] The job installs `awscli` and `s3cmd` via apt and `mc` from `https://dl.min.io/client/mc/release/linux-amd64/mc` (chmod +x to `/usr/local/bin/mc`).
- [ ] `actions/download-artifact@v4` retrieves the `docker-image` tarball and `docker load -i /tmp/openbucket.tar` loads it.
- [ ] `nx run conformance:e2e --ci` runs with env `OPENBUCKET_IMAGE: openbucket:${{ needs.build-image.outputs.image-tag }}`.
- [ ] `apps/conformance/src/object-roundtrip.conformance.ts` boots the container via `testcontainers` and asserts PUT/GET/DELETE ETag parity on a 4 MiB random payload.
- [ ] `apps/conformance/src/cli-matrix/{awscli,mc,s3cmd}.conformance.ts` shell out to each binary against the same container and assert on `execFile` output.
- [ ] The job is red when any binary's bucket-create / put / get / delete sequence fails.

## Tasks
- [TASK-1540] Scaffold `apps/conformance` Nx project with `e2e` target
- [TASK-1541] Author the AWS-SDK object-roundtrip sample
- [TASK-1542] Author the aws-cli CLI-matrix suite
- [TASK-1543] Author the mc CLI-matrix suite
- [TASK-1544] Author the s3cmd CLI-matrix suite
- [TASK-1545] Add the `conformance` GitHub Actions job
- [TASK-1546] Wire `OPENBUCKET_IMAGE` plumbing from the build-image job output

## Test plan
- [TEST-0502] Conformance suite: aws-cli, mc, s3cmd, AWS SDK matrix

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0503]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8699–8735), §5.20.3 (lines 8875–8947)
- Interfaces produced: GHA job `conformance`, Nx project `conformance`
- Interfaces consumed: `docker-image` artifact from [STORY-0503], `openbucket:<tag>` image from [STORY-0501], full S3 surface (EPIC-02, EPIC-03, EPIC-04)

## Verification status (2026-06-24) — still `review`
First real execution of the matrix (WSL Node 22 + testcontainers against `openbucket:local`, ryuk disabled):
- **aws-cli** (1.22.34) — PASS (create-bucket, cp put/get byte-equal, rm).
- **s3cmd** (2.2.0) — PASS (mb, put, get byte-equal, del).
- **AWS SDK** (object-roundtrip) — PASS.
- **mc** (RELEASE.2025-08-13) — **FAIL**: `mc cp` sends `x-amz-content-sha256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`, which OpenBucket v1 **deliberately rejects** (`put-object.interceptor.ts:108`, "Set UNSIGNED-PAYLOAD instead"). This is the **ARCHITECTURE §11 / M7 open question** (chunked-upload signing — implement or hold the v1 rejection). Modern mc has no flag to fall back to UNSIGNED-PAYLOAD, so the mc row cannot go green until chunked signing is implemented (M7). CI installs the latest mc, so the `conformance` job would hit the same. → full-matrix green is **blocked on M7**.

The mc row is now formally tracked as [STORY-0119] (M7, chunked-upload signing); the conformance suite skips it pending that work.


## Update (2026-06-24) — mc unblocked
[STORY-0119] (chunked-upload signing) is implemented and done; the `mc` row is un-skipped and **passes**. The full conformance matrix is green locally (aws-cli / s3cmd / SDK / mc, 4/4). The only remaining gap for STORY-0504 is executing the `conformance` CI job on a real GitHub Actions runner (same runner dependency as STORY-0502).

## Verification (2026-07-07)
Residual cleared — the `conformance` job (`s3 conformance suite`) now runs on real GitHub Actions runners and is **green** (PR #35's "s3 conformance suite" check passes; the job is PR/tag-gated as specified). It installs aws-cli/s3cmd/mc, loads the `docker-image` artifact, and runs `conformance:e2e` with `OPENBUCKET_IMAGE` against the built image (full aws-cli / s3cmd / SDK / mc matrix). **Deviation:** `actions/download-artifact` is pinned to `@v8` (AC said `@v4`) — a version bump. Story closed.
