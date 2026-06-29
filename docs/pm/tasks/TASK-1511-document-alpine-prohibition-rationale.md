---
id: TASK-1511
title: Document the alpine-prohibition rationale in the Dockerfile
story: STORY-0501
status: done
type: docs
size: XS
---

## Description
Add the inline comment block at the top of stage 1 explaining why `node:22-bookworm-slim` is the locked base image and why `alpine` is prohibited, so future contributors cannot silently swap the base without breaking `better-sqlite3` prebuilt bindings.

## Files to create / modify
- `Dockerfile` — modify (extend the inline comment) — written together with [TASK-1510]

## Implementation notes
- The white paper §5.17 includes this rationale comment **inside** the Dockerfile (stage 1):

  ```dockerfile
  FROM node:22-bookworm-slim AS build
  # bookworm-slim (glibc) — alpine (musl) breaks better-sqlite3 prebuilt bindings.
  # Rebuilding from source on alpine works but adds ~30s and a python toolchain.
  ```

- And, in prose, the white paper says (§5.17 closing paragraph, verbatim):
  > **Why `bookworm-slim`, not `alpine`.** `better-sqlite3` ships prebuilt native bindings linked against glibc. On alpine (musl) those bindings are silently incompatible — npm falls back to building from source, which requires `python3`, `make`, and `g++` on both build *and* runtime stages, costs 30+ seconds, and produces an image only marginally smaller than `bookworm-slim`. `bookworm-slim` is ~85 MB; `alpine` with the toolchain ends up around 110 MB. The slim Debian base is the boring, correct choice. Do not change this without a benchmarked reason.
- The Dockerfile comment must mirror this rationale (alpine prohibition + benchmarked-reason caveat). The exact comment lines from the verbatim Dockerfile are sufficient; do not paraphrase further.

## Acceptance criteria
- [ ] The Dockerfile contains a comment block at stage 1 stating the bookworm-slim choice and the alpine prohibition.
- [ ] Both stages use `node:22-bookworm-slim` (no `alpine` literals appear in the file).

## Test obligations
- Unit: N/A — docs.
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1510]

## References
- `docs/WHITEPAPER.md` §5.17 (lines 8459–8461, 8525)
