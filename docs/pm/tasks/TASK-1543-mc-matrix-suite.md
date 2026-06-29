---
id: TASK-1543
title: Author the `mc` CLI-matrix conformance suite
story: STORY-0504
status: review
type: implementation
size: S
---

## Description
Add `apps/conformance/src/cli-matrix/mc.conformance.ts`: boot the same OpenBucket container, configure an `mc` alias via `mc alias set`, then exercise bucket-create / cp / cat / rm against it. Assertions are over `execFile` stdout/stderr and exit code.

## Files to create / modify
- `apps/conformance/src/cli-matrix/mc.conformance.ts` — new

## Implementation notes
- White paper §5.20 closing note applies here (verbatim — see [TASK-1542]).
- `mc` is installed in CI from `https://dl.min.io/client/mc/release/linux-amd64/mc` to `/usr/local/bin/mc` (§5.19 lines 8714–8716).
- Configure the alias: `mc alias set ob http://host:port AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY --api S3v4`.
- Reuse the same container-boot pattern from [TASK-1541].

## Acceptance criteria
- [ ] The suite boots the container, sets up the `mc` alias, creates a bucket via `mc mb ob/conf`, copies a fixture file in via `mc cp`, reads it back via `mc cat`, removes via `mc rm`, and asserts byte equality — all green.
- [ ] `nx run conformance:e2e --testPathPattern=cli-matrix/mc` passes locally with `mc` on PATH.
- [ ] Failures surface the binary's stderr in the Jest error message.

## Test obligations
- Unit: N/A.
- E2E: N/A.
- Conformance: covered by [TEST-0502] (`mc` row of the matrix).

## Dependencies
- Blocked by: [TASK-1540], [TASK-1541]

## References
- `docs/WHITEPAPER.md` §5.20 closing paragraph (line 8947), §5.19 install step (lines 8711–8716)
