---
id: TEST-0418
title: AuditService unit spec
covers: [STORY-0413, TASK-1239, TASK-1240]
status: done
level: unit
---

## Goal
Verify `AuditService.emit` writes a structured Pino record with all caller fields plus `audit: true`, under context `'admin.audit'`.

## Setup
- Spy on the Nest `Logger.log` method (or pino's bound logger).

## Cases
1. `emit({ event: 'bucket.created', subject: 'admin', bucket: 'b1', requestId: 'r1' })` → `logger.log` called with `{ event: 'bucket.created', subject: 'admin', bucket: 'b1', requestId: 'r1', audit: true }`.
2. `emit({ event: 'admin.login', subject: 'admin', ip: '127.0.0.1' })` → record contains `ip` and `audit: true`.
3. Type-level: `AuditEvent` makes `event` and `subject` required (TS compile-only assertion).
4. Logger context is `'admin.audit'` (so pino prints `"context":"admin.audit"`).

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=audit.service.spec.ts`

## Pass criteria
- [ ] All four cases pass.

## References
- `docs/WHITEPAPER.md` §5.9 (lines 7699–7744)
