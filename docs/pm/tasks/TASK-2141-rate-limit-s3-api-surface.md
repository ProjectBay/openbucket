---
id: TASK-2141
title: Rate-limit the S3 API surface
story: STORY-0704
status: ready
type: implementation
size: M
---

## Description
Remediates audit finding #12 (LOW, **CWE-770** Allocation of Resources Without Limits
or Throttling). `ThrottlerModule` is registered but `ThrottlerGuard` is applied only
to admin login; the four S3 controllers run behind `SigV4Guard` alone, with no per-IP
or global cap. Every inbound S3 request — including unauthenticated ones — performs
work (request classification, bucket-name regex, and for known keys a `getSecret`
lookup plus SigV4 canonicalization/HMAC) before rejection, so a flood saturates CPU
and the SQLite connection at near-zero attacker cost. This Task binds a throttler over
the S3 surface as defence-in-depth, closing the login-vs-data-plane inconsistency.

## Files to create / modify
- `libs/nestjs/src/lib/admin/admin.module.ts` — modify: add
  `{ provide: APP_GUARD, useClass: ThrottlerGuard }` alongside the existing
  `JwtAuthGuard` binding so the configured default throttler covers the whole app,
  S3 controllers included.
- `libs/nestjs/src/lib/s3/controllers/object.controller.ts`,
  `bucket.controller.ts`, `multipart.controller.ts`, `service.controller.ts` —
  modify: apply `@Throttle` (or a named S3 throttler) to tune per-route buckets so
  legitimate high-throughput clients are not broken.
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify (optional): expose the
  S3 throttle limit/ttl as config so operators can tune or disable it behind a proxy.

## Implementation notes
- Current state: `admin.module.ts:46` calls
  `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }, { ttl: 60_000, limit: 5, name: 'login' }])`,
  but the only `APP_GUARD` bound is `JwtAuthGuard` (`admin.module.ts:53`), and
  `ThrottlerGuard` is attached solely via `@UseGuards` on the login route
  (`auth.controller.ts:59`). All four S3 controllers carry only
  `@UseGuards(SigV4Guard)`.
- Fix per the audit fix-note: bind `ThrottlerGuard` globally —
  `{ provide: APP_GUARD, useClass: ThrottlerGuard }` next to the `JwtAuthGuard`
  binding — so the 100/min-per-IP default actually covers the S3 controllers. Because
  the data plane is high-throughput, give S3 a **higher, separate named bucket** (e.g.
  a named throttler) rather than the admin 100/min, so legitimate clients are not
  throttled.
- `ThrottlerGuard` keys on `req.ip`; the app already sets `trust proxy 'loopback'`, so
  ensure the S3 request path preserves the client IP.
- Secondary hardening (optional, note in PR): add brief negative caching for unknown
  `accessKeyId`s in `KeyService.getSecret` so a bad-key flood does not re-hit the DB
  even at primary-key cost. Document that the primary volumetric-DoS control remains an
  upstream reverse proxy / API gateway; this in-app throttler is defence-in-depth.

## Acceptance criteria
- [ ] Exceeding the configured S3 rate from one IP returns HTTP 429 (`SlowDown`/
      `ThrottlerException`) on `object.controller` routes, not just admin login.
- [ ] `@SkipThrottle`/`@Throttle` overrides let a documented high-throughput route
      use a wider bucket, verified by a spec.
- [ ] The existing admin login `@Throttle('login', ...)` behaviour is unchanged.

## Test obligations
- Unit: covered by [TEST-0704] (guard is bound app-wide; S3 route throttles)
- E2E: covered by [TEST-0704] (burst of GETs from one IP eventually 429s)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-2100], [STORY-0700]

## References
- White-box security audit, 2026-07-04 — finding #12 (CWE-770).
- `libs/nestjs/src/lib/admin/admin.module.ts:46,53`
- `libs/nestjs/src/lib/admin/auth/auth.controller.ts:59`
- `libs/nestjs/src/lib/s3/controllers/{object,bucket,multipart,service}.controller.ts`
</content>
