---
id: TASK-1513
title: Document the `GET /api/admin/health` contract the Dockerfile HEALTHCHECK consumes
story: STORY-0501
status: done
type: docs
size: XS
---

## Description
The Dockerfile `HEALTHCHECK` fetches `http://127.0.0.1:9000/api/admin/health` and expects a 2xx response. The endpoint itself is implemented under [EPIC-05] (admin module) but this Task locks down the contract from EPIC-06's side so the healthcheck doesn't silently break: public (no auth, marked `@Public()`), returns `{ status: 'ok' }`, lives on a `HealthController` exported by `AdminModule`.

## Files to create / modify
- _No files in this Task; this is a contract pin documented in the Story for EPIC-05 to honor._
- `docs/pm/stories/STORY-0501-docker-multi-stage-build-image.md` — already references this Task.

## Implementation notes
- White paper §5.17 (closing paragraph) verbatim:
  > The healthcheck pings a tiny `GET /api/admin/health` endpoint (returns `{ status: 'ok' }`, public, no auth) — its implementation lives in a `HealthController` exported by `AdminModule` but marked `@Public()`.
- The HEALTHCHECK directive from the Dockerfile (verbatim):

  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:9000/api/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  ```

- Coordination note: if [EPIC-05] moves the endpoint, the Dockerfile HEALTHCHECK URL must move with it.

## Acceptance criteria
- [ ] This file references the exact endpoint URL, status-code expectation, and `@Public()` requirement.
- [ ] [STORY-0501] acceptance criteria are aligned with this contract.
- [ ] A cross-reference appears in any [EPIC-05] HealthController Story (verified by grep at refinement time).

## Test obligations
- Unit: N/A — contract pin.
- E2E: implicitly verified by [TEST-0501] (`docker run` + curl `/api/admin/health`).
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §5.17 (lines 8519–8527)
