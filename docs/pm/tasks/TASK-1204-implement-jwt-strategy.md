---
id: TASK-1204
title: Implement JwtStrategy passport adapter
story: STORY-0401
status: done
type: implementation
size: XS
---

## Description
Add `apps/backend/src/admin/auth/jwt.strategy.ts` as the passport adapter named in `AuthModule.providers`. While the operational guard for admin auth is `JwtAuthGuard` (§5.3), `passport-jwt` is registered because `PassportModule` is imported and openapi-generator may emit `BearerAuth` security based on it.

## Files to create / modify
- `apps/backend/src/admin/auth/jwt.strategy.ts` — new

## Implementation notes
- Standard `PassportStrategy(Strategy)` from `passport-jwt`.
- `jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()`.
- `secretOrKey: ConfigService.getOrThrow<string>('JWT_SECRET')`.
- `issuer: 'openbucket'`, `audience: 'openbucket-admin'` (mirrors §5.2.1 sign options).
- `validate(payload)` returns the payload object so it lands on `req.user`.

## Acceptance criteria
- [ ] `JwtStrategy` is `Injectable` and extends `PassportStrategy(Strategy)`.
- [ ] Validation parameters match `JwtModule.registerAsync` (issuer / audience / secret).

## Test obligations
- Unit: covered by [TEST-0401]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1202]

## References
- `docs/WHITEPAPER.md` §5.2.1 (lines 6791–6802)
