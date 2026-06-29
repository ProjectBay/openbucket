---
id: TEST-0402
title: RefreshTokenService unit spec (mint, rotate, revoke)
covers: [STORY-0402, TASK-1205, TASK-1206, TASK-1207]
status: done
level: unit
---

## Goal
Verify all branches of `RefreshTokenService`: mint, rotation success, expiry, revoked, reuse-detection, hash-mismatch, idempotent revoke.

## Setup
- Mock `RefreshTokenRepository` with in-memory map keyed by `lookup`.
- Use a fake `Date.now()` clock so TTL math is deterministic.

## Cases
1. Mint produces a 43-char base64url token (32 random bytes), an indexed `lookup = sha256(raw).hex`, and an argon2id `hash`.
2. `rotate(raw)` against a fresh row marks the row rotated and returns a new `RotatedRefresh` with `rotatedFromId` pointing at the parent.
3. `rotate(raw)` against a missing lookup throws `UnauthorizedException('invalid refresh')`.
4. `rotate(raw)` against a row whose `revokedAt` is set throws `'revoked'`.
5. `rotate(raw)` against an expired row throws `'expired'`.
6. `rotate(raw)` against a row whose `rotatedAt` is already set calls `repo.revokeDescendants(row.id)` and throws `'token reuse detected'`.
7. `rotate(raw)` whose argon2 hash does not match throws `'invalid refresh'`.
8. `revoke(unknownToken)` is a no-op (no repo write).
9. `revoke(alreadyRevokedToken)` is a no-op.
10. `revoke(validToken)` calls `repo.revoke(id, now)` exactly once.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=refresh-token.service.spec.ts`

## Pass criteria
- [ ] All ten cases pass.

## References
- `docs/WHITEPAPER.md` §5.2.3 (lines 6899–6977)
