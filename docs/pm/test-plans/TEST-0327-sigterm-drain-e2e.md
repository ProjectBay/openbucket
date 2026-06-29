---
id: TEST-0327
title: SIGTERM drain e2e via supertest
covers: [STORY-0319]
status: done
level: e2e
---

## Goal
End-to-end: while a slow PUT is in flight, send SIGTERM to the backend process; the in-flight stream completes within 30s; new requests are rejected; the process exits cleanly.

## Setup
- Spawn the backend as a child process bound to an ephemeral port (`child_process.spawn`).
- A slow PUT helper streams 50 MiB with artificial 100 ms delays between 256 KiB chunks (so the PUT takes ≥ 20s).

## Cases
1. Start the backend; begin a slow PUT; once `Content-Length` bytes of progress are observed, `kill(pid, 'SIGTERM')`. Assert: the slow PUT completes with HTTP 200; a separate, second PUT issued AFTER SIGTERM is refused (ECONNREFUSED or "server stopped accepting").
2. Start the backend; begin a 60-second-long PUT; `kill(pid, 'SIGTERM')`. After 30s drain deadline, assert: the PUT is forcibly terminated (socket destroyed); the process exits within ~31s.
3. After shutdown, the SQLite WAL is checkpointed (data file is consistent on restart).

## Tooling
- Framework: jest, supertest, child_process
- Runner: `nx e2e backend-e2e --testPathPattern=shutdown.e2e-spec.ts`

## Pass criteria
- [ ] All three cases pass.

## References
- `docs/WHITEPAPER.md` §4.12 (lines 6547–6658)
