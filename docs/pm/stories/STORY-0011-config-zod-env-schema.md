---
id: STORY-0011
title: Implement Zod-validated env schema and AppConfigService
epic: EPIC-01
status: done
size: M
risk: medium
---

## User story
As an operator, I want missing or malformed environment variables to fail the boot synchronously with a clear stderr listing of every offending key, so that misconfiguration never silently produces a half-functional container.

## Description
Implement `apps/backend/src/common/config/env.schema.ts` per §1.7, exporting `EnvSchema`, `Env`, and `loadEnv(raw)`. Use `z.strict()` and the field set from §1.7 verbatim (NODE_ENV, PORT, LOG_LEVEL, DATA_DIR, JWT_SECRET, JWT_ACCESS_TTL_SECONDS, JWT_REFRESH_TTL_SECONDS, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, ROOT_ACCESS_KEY_ID, ROOT_SECRET_ACCESS_KEY, OPENBUCKET_ENDPOINT, OPENBUCKET_REGION, MAX_OBJECT_SIZE_MB, MAX_MULTIPART_PARTS, MULTIPART_TTL_HOURS, SHUTDOWN_DRAIN_MS). On failure, format issues with `'  - ${path}: ${message}'` and throw. Implement `apps/backend/src/common/config/app-config.service.ts` as the typed wrapper around `ConfigService<Env, true>` exposing all getters listed in §1.7. Implement `apps/backend/src/common/config/config.module.ts` providing `AppConfigService` and depending on the global `ConfigModule.forRoot`.

## Acceptance criteria
- [ ] `EnvSchema` is `.strict()` (unknown env vars cause a validation error).
- [ ] All 17 env keys and their constraints from §1.7 are present verbatim (regex, ranges, defaults).
- [ ] `loadEnv` throws on validation failure with `Refusing to boot: invalid environment.` after printing a multiline issue listing to stderr.
- [ ] `AppConfigService` exposes every getter listed in §1.7 with the documented return types.
- [ ] Booting with `DATA_DIR=""` causes `nx serve openbucket-backend` to exit non-zero before listening.

## Tasks
- [TASK-0028] Define Zod EnvSchema
- [TASK-0029] Implement loadEnv with multiline stderr formatting
- [TASK-0030] Implement AppConfigService typed wrapper
- [TASK-0031] Implement ConfigModule provider

## Test plan
- [TEST-0012] Env schema validation and refusal-to-boot (unit)

## Dependencies
- Blocks: [STORY-0002], [STORY-0004], [STORY-0007], [STORY-0015]
- Blocked by: [STORY-0001]

## References
- `docs/WHITEPAPER.md` §1.7 (lines 706–816)
- Interfaces produced: `Env`, `EnvSchema`, `loadEnv` (consumed by STORY-0004); `AppConfigService` (consumed by STORY-0002, STORY-0007, STORY-0015, and across EPIC-02, EPIC-03, EPIC-04, EPIC-05)
