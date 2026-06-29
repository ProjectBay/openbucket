---
id: TASK-1542
title: Author the `aws-cli` CLI-matrix conformance suite
story: STORY-0504
status: review
type: implementation
size: S
---

## Description
Add `apps/conformance/src/cli-matrix/awscli.conformance.ts`: boot the same OpenBucket container as the SDK sample, then shell out to the `aws` binary (installed in CI by §5.19) to exercise bucket-create, put, get, delete on a small payload. Assertions are over `execFile` stdout/stderr and exit code.

## Files to create / modify
- `apps/conformance/src/cli-matrix/awscli.conformance.ts` — new

## Implementation notes
- White paper §5.20 closing note (verbatim):
  > A sibling matrix runs the same flow under `aws-cli`, `mc`, and `s3cmd` shelling out to the binaries installed in CI — those tests live in `apps/conformance/src/cli-matrix/*.conformance.ts` and are mostly assertions over `execFile` output. The `OPENBUCKET_IMAGE` env var is set by the CI workflow (§5.19) so the same suite runs against the just-built PR image.
- Use `aws --endpoint-url=http://host:port --region=us-east-1` and the sentinel `AKIAIOSFODNN7EXAMPLE` / `wJalrXUtnFEMI/...` keys via env (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).
- Follow the same container-boot pattern from [TASK-1541] (`testcontainers`, `Wait.forHttp('/api/admin/health', 9000)`).
- Use `node:child_process`'s `execFile` (or `promisify(execFile)`); avoid `exec` (shell) to keep argv composition safe.

## Acceptance criteria
- [ ] The suite boots the container, creates a bucket via `aws s3api create-bucket`, puts and gets an object, asserts byte equality, and deletes it — all green.
- [ ] `nx run conformance:e2e --testPathPattern=cli-matrix/awscli` passes locally with a built `openbucket:local` image and `aws` on PATH.
- [ ] Failures surface the binary's stderr in the Jest error message.

## Test obligations
- Unit: N/A.
- E2E: N/A.
- Conformance: covered by [TEST-0502] (this Task contributes the `awscli` row of the matrix).

## Dependencies
- Blocked by: [TASK-1540], [TASK-1541]

## References
- `docs/WHITEPAPER.md` §5.20 closing paragraph (line 8947), §5.19 install step (lines 8711–8716)
