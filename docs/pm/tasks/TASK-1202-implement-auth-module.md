---
id: TASK-1202
title: Implement auth.module.ts with JwtModule.registerAsync and login throttler
story: STORY-0401
status: done
type: implementation
size: S
---

## Description
Implement the `AuthModule` per §5.2.1: imports `PassportModule`, `PersistenceModule`, a named login `ThrottlerModule`, and `JwtModule.registerAsync` configured from `ConfigService`. Controllers `[AuthController]`. Providers `[AuthService, JwtStrategy, RefreshTokenService, AuditService]`. Exports `[AuthService, JwtModule]`.

## Files to create / modify
- `apps/backend/src/admin/auth/auth.module.ts` — modify (replace placeholder)

## Implementation notes
- JwtModule factory verbatim:
  ```ts
  JwtModule.registerAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (cfg: ConfigService) => ({
      secret: cfg.getOrThrow<string>('JWT_SECRET'),
      signOptions: { expiresIn: '15m', issuer: 'openbucket', audience: 'openbucket-admin' },
    }),
  })
  ```
- Login throttler: `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5, name: 'login' }])`.
- `getOrThrow` (not `get`) ensures the app refuses to boot without `JWT_SECRET`.

## Acceptance criteria
- [ ] `auth.module.ts` matches §5.2.1 verbatim.
- [ ] App fails to boot if `JWT_SECRET` is missing.

## Test obligations
- Unit: covered by [TEST-0401]
- E2E: covered by [TEST-0404] (login wiring smoke)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1201]

## References
- `docs/WHITEPAPER.md` §5.2.1 (lines 6769–6809)
