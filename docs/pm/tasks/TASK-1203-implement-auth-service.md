---
id: TASK-1203
title: Implement AuthService login / refresh / logout / issueTokens
story: STORY-0401
status: done
type: implementation
size: M
---

## Description
Implement `auth.service.ts` per §5.2.2. Exposes `login(username, password)`, `refresh(rawRefreshToken)`, `logout(rawRefreshToken?)`, and a private `issueTokens(...)` that signs the access JWT with claims `{ sub, username, mustChangePassword }`.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.service.ts` — new

## Implementation notes
- Constant-time dummy verify on user-miss (verbatim from §5.2.2):
  ```ts
  await argon2.verify(
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    password,
  ).catch(() => false);
  ```
- TTL constant `ACCESS_TTL_SECONDS = 15 * 60`.
- Access JWT payload `{ sub: subjectId, username, mustChangePassword }`.
- Export `IssuedTokens` interface with `{ accessToken, expiresIn, refreshToken, refreshExpiresAt }`.
- On `refresh()`, do not mint a fresh refresh — pass the rotated refresh through to `issueTokens` via `preIssuedRefreshRaw` / `preIssuedRefreshExpiresAt` so we never double-mint.

## Acceptance criteria
- [ ] `login` returns `IssuedTokens` on valid credentials; throws `UnauthorizedException('invalid credentials')` on missing user or bad password.
- [ ] Missing-user path executes the dummy `argon2.verify` for constant-time response.
- [ ] `refresh` delegates rotation to `RefreshTokenService.rotate` and emits new access token but the **rotated** refresh.
- [ ] `logout` calls `RefreshTokenService.revoke` only when the raw token is defined.
- [ ] Access JWT claim shape matches `{ sub, username, mustChangePassword }`.

## Test obligations
- Unit: covered by [TEST-0401]
- E2E: covered by [TEST-0404]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1202]

## References
- `docs/WHITEPAPER.md` §5.2.2 (lines 6811–6897)
