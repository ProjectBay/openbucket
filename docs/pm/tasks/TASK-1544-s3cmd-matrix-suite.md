---
id: TASK-1544
title: Author the `s3cmd` CLI-matrix conformance suite
story: STORY-0504
status: review
type: implementation
size: S
---

## Description
Add `apps/conformance/src/cli-matrix/s3cmd.conformance.ts`: boot the same OpenBucket container, write a temp `.s3cfg` pointing at the container's mapped port, then exercise `s3cmd mb`, `s3cmd put`, `s3cmd get`, and `s3cmd del`. Assertions are over `execFile` stdout/stderr and exit code.

## Files to create / modify
- `apps/conformance/src/cli-matrix/s3cmd.conformance.ts` — new

## Implementation notes
- White paper §5.20 closing note applies here (verbatim — see [TASK-1542]).
- `s3cmd` is installed in CI from apt (`apt-get install -y --no-install-recommends awscli s3cmd`, §5.19 line 8714).
- Minimal `.s3cfg` (written to `mkdtempSync`-ed dir; pass with `s3cmd -c <path>`):

  ```ini
  [default]
  host_base = <host>:<port>
  host_bucket = <host>:<port>
  use_https = False
  access_key = AKIAIOSFODNN7EXAMPLE
  secret_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
  signature_v2 = False
  ```

- Reuse the same container-boot pattern from [TASK-1541].

## Acceptance criteria
- [ ] The suite boots the container, writes a temp `.s3cfg`, creates a bucket via `s3cmd mb`, puts/gets/deletes an object, and asserts byte equality — all green.
- [ ] `nx run conformance:e2e --testPathPattern=cli-matrix/s3cmd` passes locally with `s3cmd` on PATH.
- [ ] Failures surface the binary's stderr in the Jest error message.

## Test obligations
- Unit: N/A.
- E2E: N/A.
- Conformance: covered by [TEST-0502] (`s3cmd` row of the matrix).

## Dependencies
- Blocked by: [TASK-1540], [TASK-1541]

## References
- `docs/WHITEPAPER.md` §5.20 closing paragraph (line 8947), §5.19 install step (lines 8711–8716)
