---
id: STORY-0402
title: Implement RefreshTokenService with rotation and reuse revocation
epic: EPIC-05
status: done
size: M
risk: high
---

## User story
As an operator, I want refresh tokens to be rotated on every use and reuse of a rotated token to revoke the entire chain, so that a stolen refresh token causes self-detected lockout rather than silent access.

## Description
Build `apps/backend/src/admin/auth/refresh-token.service.ts` per §5.2.3. `mint(subjectId, username, rotatedFromId?)` generates a 32-byte base64url raw token, an indexed SHA-256 `lookup`, an argon2id `hash`, and a 7-day `expiresAt`. `rotate(rawToken)` finds the row by lookup, rejects revoked / expired tokens, detects already-rotated tokens as compromise (calling `repo.revokeDescendants(row.id)` and throwing), verifies the argon2id hash, marks the row rotated, mints a child, and returns `{ token, expiresAt, subjectId, username }`. `revoke(rawToken)` no-ops on missing/already-revoked, otherwise marks revoked.

## Acceptance criteria
- [x] `RefreshTokenService.TTL_MS = 7 * 24 * 60 * 60 * 1000`.
- [x] `mint` writes a row with `lookup = sha256(raw)`, `hash = argon2id(raw)`, `rotatedFromId` set when provided, and `expiresAt` 7d in the future; raw is base64url over 32 random bytes.
- [x] `rotate` throws `UnauthorizedException('invalid refresh')` for unknown lookup or hash mismatch, `'revoked'` if `revokedAt` set, `'expired'` if past TTL, `'token reuse detected'` if `rotatedAt` set (also calls `repo.revokeDescendants(row.id)`).
- [x] `rotate` on success calls `repo.markRotated(id, now)` then `mint(subjectId, username, parentId)`.
- [x] `revoke` is idempotent on missing or already-revoked rows.

## Tasks
- [TASK-1205] Implement `RefreshTokenService.mint`
- [TASK-1206] Implement `RefreshTokenService.rotate` with reuse-detection branch
- [TASK-1207] Implement `RefreshTokenService.revoke`

## Test plan
- [TEST-0402] RefreshTokenService unit spec (rotation paths)
- [TEST-0403] Refresh-token rotation and reuse-revocation e2e

## Dependencies
- Blocks: [STORY-0404]
- Blocked by: [STORY-0401], [EPIC-03] (`RefreshTokenRepository` with `insert`, `findByLookup`, `markRotated`, `revoke`, `revokeDescendants`)

## References
- `docs/WHITEPAPER.md` §5.2.3 (lines 6899–6977)
- Interfaces produced: `RefreshTokenService` (`mint`, `rotate`, `revoke`), `MintedRefresh`, `RotatedRefresh`
- Interfaces consumed: `RefreshTokenRepository` (EPIC-03)
