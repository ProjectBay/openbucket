---
id: TEST-0012
title: Env schema validation and refuse-to-boot semantics
covers: [STORY-0011, TASK-0028, TASK-0029, TASK-0030, TASK-0031]
status: done
level: unit
---

## Goal
Verify `EnvSchema` accepts a documented-correct env, rejects each refuse-to-boot key, and that `AppConfigService` exposes every getter.

## Setup
- Compose a baseline valid env object in a Jest helper:
  ```ts
  const baseEnv = {
    DATA_DIR: '/data',
    JWT_SECRET: 'a'.repeat(32),
    ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    ROOT_ACCESS_KEY_ID: 'AKIA1234567890ABCD',
    ROOT_SECRET_ACCESS_KEY: 'x'.repeat(40),
  };
  ```

## Cases
1. Given `baseEnv`, when `loadEnv` runs, then no throw and `result.PORT === 9000`, `result.OPENBUCKET_REGION === 'us-east-1'`, `result.SHUTDOWN_DRAIN_MS === 30_000`, `result.LOG_LEVEL === 'info'`.
2. Given `baseEnv` with `DATA_DIR=''`, then `loadEnv` throws `Refusing to boot: invalid environment.` and stderr contains `'  - DATA_DIR: '`.
3. Given `baseEnv` with `DATA_DIR='/data/'`, then `loadEnv` throws with message `'DATA_DIR must not have a trailing slash'`.
4. Given `baseEnv` with `JWT_SECRET='short'`, then `loadEnv` throws and stderr lists `JWT_SECRET must be at least 32 characters`.
5. Given `baseEnv` with `ROOT_ACCESS_KEY_ID='lowercasekey1234'`, then `loadEnv` throws.
6. Given `baseEnv` with `ADMIN_PASSWORD_HASH='$argon2i$...'`, then `loadEnv` throws.
7. Given `baseEnv` with `OPENBUCKET_ENDPOINT='INVALID_DOMAIN'`, then `loadEnv` throws.
8. Given `baseEnv` with `EXTRA_KEY='unused'`, then `loadEnv` throws (strict schema rejects unknown keys).
9. Given `baseEnv` with `SHUTDOWN_DRAIN_MS='5000'`, then `result.SHUTDOWN_DRAIN_MS === 5000` (coerced to number).
10. Given a Nest test module booting `ConfigModule` + `AppConfigService`, when `service.dataDir` is read, then it returns `/data` (and all 17 getters are accessible).

## Tooling
- Framework: jest
- Runner: `nx test openbucket-backend --testPathPattern=env.schema.spec`

## Pass criteria
- [ ] All 10 cases pass.
- [ ] Schema rejects unknown env vars (`strict`).

## References
- `docs/WHITEPAPER.md` §1.7 (lines 706–816)
