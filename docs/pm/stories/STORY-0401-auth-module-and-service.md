---
id: STORY-0401
title: Stand up AuthModule and AuthService
epic: EPIC-05
status: done
size: M
risk: medium
---

## User story
As a developer, I want the `AuthModule` to register the `JwtModule`, `PassportModule`, and login-scoped throttler and expose `AuthService.login` / `refresh` / `logout`, so that the auth controller can issue and validate admin tokens.

## Description
Build `apps/backend/src/admin/auth/auth.module.ts` per §5.2.1, including `JwtModule.registerAsync` configured with `JWT_SECRET` (via `ConfigService.getOrThrow`), `expiresIn: '15m'`, `issuer: 'openbucket'`, `audience: 'openbucket-admin'`, and a named login throttler at `5/min`. Implement `auth.service.ts` per §5.2.2: argon2id password verification with constant-time dummy verify on user-miss, `issueTokens` that signs an access JWT with claims `{ sub, username, mustChangePassword }`, and a TTL constant `ACCESS_TTL_SECONDS = 15 * 60`. Defines and exports the `IssuedTokens` interface.

## Acceptance criteria
- [x] `auth.module.ts` matches §5.2.1: registers `JwtModule`, `PassportModule`, `ThrottlerModule` with named `login` config `{ ttl: 60_000, limit: 5, name: 'login' }`, imports `PersistenceModule`, declares `AuthController`, provides `AuthService`, `JwtStrategy`, `RefreshTokenService`, `AuditService`.
- [x] `AuthService.login(username, password)` returns `IssuedTokens` on valid credentials and throws `UnauthorizedException('invalid credentials')` on missing user or wrong password.
- [x] On missing user, a dummy `argon2.verify` against a fixed hash is executed for constant-time behaviour.
- [x] `AuthService.refresh(raw)` delegates to `RefreshTokenService.rotate` and emits new access token with the pre-issued refresh token from rotation.
- [x] `AuthService.logout(raw)` calls `RefreshTokenService.revoke` when raw is defined.
- [x] Access JWT contains claims `{ sub, username, mustChangePassword }`.

## Tasks
- [TASK-1202] Implement `auth.module.ts` with JwtModule.registerAsync and ThrottlerModule
- [TASK-1203] Implement `AuthService` with login/refresh/logout and `issueTokens`
- [TASK-1204] Implement `JwtStrategy` passport adapter

## Test plan
- [TEST-0401] AuthService unit spec

## Dependencies
- Blocks: [STORY-0403], [STORY-0404], [STORY-0405], [STORY-0407]
- Blocked by: [STORY-0400], [EPIC-01] (ConfigModule with `JWT_SECRET`), [EPIC-03] (`AdminUserRepository`)

## References
- `docs/WHITEPAPER.md` §5.2.1 (lines 6769–6809), §5.2.2 (lines 6811–6897)
- `docs/BACKEND-DESIGN.md` §4.1
- Interfaces produced: `AuthService`, `IssuedTokens`
- Interfaces consumed: `AdminUserRepository` (EPIC-03), `RefreshTokenRepository` (EPIC-03)
