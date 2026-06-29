---
id: TEST-0401
title: AuthService unit spec
covers: [STORY-0401, TASK-1203, TASK-1204]
status: done
level: unit
---

## Goal
Verify `AuthService.login` / `refresh` / `logout` behaviour including constant-time response on user-miss, claim shape, and delegation to `RefreshTokenService`.

## Setup
- Mock `JwtService.signAsync` to return a deterministic string.
- Mock `AdminUserRepository.findByUsername`.
- Mock `RefreshTokenService.mint` / `rotate` / `revoke`.

## Cases
1. Given valid credentials, when `login` is called, then it returns `IssuedTokens` with `accessToken` non-empty, `expiresIn = 900`, refresh token from `mint`, and signed payload `{ sub, username, mustChangePassword }`.
2. Given a missing user, when `login` is called, then the dummy `argon2.verify` against the literal fixed hash from §5.2.2 is invoked once before `UnauthorizedException('invalid credentials')` is thrown.
3. Given a wrong password, when `login` is called, then `UnauthorizedException('invalid credentials')` is thrown.
4. Given a valid refresh token, when `refresh` is called, then `RefreshTokenService.rotate` is called once and the returned access token claims include `mustChangePassword: false`.
5. Given an undefined refresh token, when `logout(undefined)` is called, then `RefreshTokenService.revoke` is NOT called and the call resolves cleanly.
6. Given a defined refresh token, when `logout(raw)` is called, then `RefreshTokenService.revoke(raw)` is called once.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=auth.service.spec.ts`

## Pass criteria
- [ ] All six cases pass.

## References
- `docs/WHITEPAPER.md` §5.2.2 (lines 6811–6897)
