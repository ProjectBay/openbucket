---
id: TASK-2151
title: Strengthen secret-entropy validation
story: STORY-0705
status: ready
type: implementation
size: XS
---

## Description
Remediates audit finding [18] (info, CWE-521 Weak Password Requirements).
`JWT_SECRET` and `ROOT_SECRET_ACCESS_KEY` are gated only by a bare `.min(32)`
length check, so a 32-char but trivially-guessable value (all-identical chars, a
docs placeholder, a dictionary phrase) boots cleanly — and because `JWT_SECRET` is
the HMAC key for admin access/refresh tokens, a predictable value enables offline
JWT forgery and full admin-API bypass. Keep the length floor but add a cheap,
low-false-positive placeholder/low-entropy guard to the refuse-to-boot gate, in
both the standalone schema and the mirrored library guard.

## Files to create / modify
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify. Extend the
  `JWT_SECRET` (line 19) and `ROOT_SECRET_ACCESS_KEY` (lines 36-38) validators
  with a `.refine(...)` (or shared `strongSecret` Zod helper) that rejects
  all-identical strings, a small placeholder denylist, and values with too few
  distinct characters.
- `libs/nestjs/src/lib/open-bucket-options.ts` — modify. Apply the identical
  refinement to `rootCredentials.secretAccessKey` and `admin.jwtSecret` inside
  `validateSecurityCriticalOptions` (lines 172-190) so standalone and embedded
  modes stay in sync.
- `libs/nestjs/src/lib/common/config/env.schema.spec.ts` — modify. The existing
  suite uses `'a'.repeat(32)` / `'x'.repeat(40)` as the *valid* baseline
  (finding cites env.schema.spec.ts:12); update those fixtures to a
  CSPRNG-style value that passes the new guard, and add negative cases.

## Implementation notes
- Vulnerable validators (env.schema.ts):
  ```ts
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // ...
  ROOT_SECRET_ACCESS_KEY: z
    .string()
    .min(32, 'ROOT_SECRET_ACCESS_KEY must be at least 32 characters'),
  ```
  Mirror in `open-bucket-options.ts:176-186` (`secretAccessKey` / `jwtSecret`,
  both `.min(32)` only).
- Prefer cheap heuristics over a real entropy estimator (which false-rejects):
  1. Reject all-identical characters: `/^(.)\1+$/` (kills `'a'.repeat(32)`).
  2. Reject a small case-insensitive placeholder denylist: `changeme`, `secret`,
     `please-change-me`, `password`, and known docs example values.
  3. Require more than N distinct characters (e.g. `new Set(v).size >= 8`) as a
     coarse entropy proxy.
  Keep the `.min(32)` floor; the guard is purely additive and preserves the
  existing `Refusing to boot: invalid environment.` semantics and per-field
  message list.
- Factor the rule once, e.g.:
  ```ts
  const PLACEHOLDERS = new Set(['changeme', 'secret', 'please-change-me', 'password']);
  const strongSecret = (label: string) =>
    z.string()
      .min(32, `${label} must be at least 32 characters`)
      .refine((v) => !/^(.)\1+$/.test(v), `${label} must not be a single repeated character`)
      .refine((v) => !PLACEHOLDERS.has(v.toLowerCase()), `${label} must not be a known placeholder`)
      .refine((v) => new Set(v).size >= 8, `${label} has too few distinct characters`);
  ```
  Apply `strongSecret('JWT_SECRET')` and `strongSecret('ROOT_SECRET_ACCESS_KEY')`.
- CWE-521. Info severity: the attacker cannot influence the secret; they only win
  if the operator/scaffolding freely chooses a weak one. No default/example secret
  ships in code (`config-source.ts` defaults `jwtSecret` to `''`, which already
  fails `min(32)`), so this is defense-in-depth, not a latent exploitable flaw.
  Also document generating secrets via `openssl rand -base64 48`.

## Acceptance criteria
- [ ] Booting with `JWT_SECRET='a'.repeat(32)` is rejected with a per-field reason
      (covered by [TEST-0705] case 5).
- [ ] Booting with a placeholder like `'changeme...'` (padded ≥32) is rejected
      (case 6).
- [ ] A high-entropy 44-char base64 secret boots cleanly (case 7).
- [ ] The same rejection applies through `validateSecurityCriticalOptions` in the
      library path (case 8).
- [ ] `nx test nestjs --testPathPattern=env.schema.spec` passes with the updated
      fixtures.

## Test obligations
- Unit: covered by [TEST-0705] (schema accept/reject cases + library mirror).
- E2E: N/A — validation is a boot-time pure function.
- Conformance: N/A.

## Dependencies
- Blocked by: none. Independent of [TASK-2150]; both land under [STORY-0705].

## References
- White-box security audit, 2026-07-04 — finding [18] (CWE-521).
- `libs/nestjs/src/lib/common/config/env.schema.ts:19,36-38`.
- `libs/nestjs/src/lib/open-bucket-options.ts:172-190`.
- `libs/nestjs/src/lib/common/config/env.schema.spec.ts:12` (valid-baseline fixture).
