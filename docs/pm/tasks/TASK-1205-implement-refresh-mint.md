---
id: TASK-1205
title: Implement RefreshTokenService.mint
story: STORY-0402
status: done
type: implementation
size: S
---

## Description
Mint a fresh refresh token: generate 32 random bytes encoded as base64url, compute the indexed SHA-256 lookup, compute the argon2id hash, and insert a `refresh_tokens` row with the supplied `subjectId`, `username`, `rotatedFromId`, `issuedAt`, and `expiresAt = now + 7d`.

## Files to create / modify
- `apps/backend/src/admin/auth/refresh-token.service.ts` — new (skeleton + `mint`)

## Implementation notes
- Verbatim from §5.2.3:
  ```ts
  const raw = randomBytes(32).toString('base64url');
  const lookup = createHash('sha256').update(raw).digest('hex'); // indexed
  const hash = await argon2.hash(raw, { type: argon2.argon2id });
  const expiresAt = new Date(Date.now() + RefreshTokenService.TTL_MS);
  ```
- TTL `private static readonly TTL_MS = 7 * 24 * 60 * 60 * 1000;`.
- Repository `insert` shape per §5.2.3:
  ```ts
  await this.repo.insert({
    lookup, hash, subjectId, username,
    issuedAt: new Date(), expiresAt,
    rotatedFromId: rotatedFromId ?? null,
    revokedAt: null, rotatedAt: null,
  });
  ```
- Return `MintedRefresh = { token: raw, expiresAt }`.

## Acceptance criteria
- [ ] `mint` produces a base64url string of 32 random bytes (length 43).
- [ ] `lookup` is `sha256(raw).hex`; `hash` is argon2id of raw.
- [ ] `expiresAt` is exactly `now + 7 days`.
- [ ] `rotatedFromId` is forwarded to the repo (or `null` when omitted).

## Test obligations
- Unit: covered by [TEST-0402]
- E2E: covered by [TEST-0403]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1202]

## References
- `docs/WHITEPAPER.md` §5.2.3 (lines 6925–6944)
