---
id: TASK-0028
title: Define Zod EnvSchema with refuse-to-boot fields
story: STORY-0011
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/common/config/env.schema.ts` exporting `EnvSchema`, `Env`, and `loadEnv`. The schema covers seventeen env vars in four groups (runtime, persistence, admin auth, S3 protocol, limits, shutdown), with the constraints from §1.7 quoted verbatim.

## Files to create / modify
- `apps/openbucket-backend/src/common/config/env.schema.ts` — new

## Implementation notes
- Quote §1.7 (lines 714–763) verbatim:
  ```ts
  const portNumber = z.coerce.number().int().min(1).max(65_535);

  export const EnvSchema = z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
      PORT: portNumber.default(9000),
      LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
      DATA_DIR: z
        .string()
        .min(1, 'DATA_DIR must be set to a host-mounted directory')
        .refine((p) => !p.endsWith('/'), 'DATA_DIR must not have a trailing slash'),
      JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
      JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
      JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).max(2_592_000).default(604_800),
      ADMIN_USERNAME: z.string().min(1).default('admin'),
      ADMIN_PASSWORD_HASH: z.string().regex(/^\$argon2id\$/, 'ADMIN_PASSWORD_HASH must be an argon2id hash'),
      ROOT_ACCESS_KEY_ID: z.string().regex(/^[A-Z0-9]{16,32}$/, 'ROOT_ACCESS_KEY_ID must be 16-32 uppercase alphanumerics'),
      ROOT_SECRET_ACCESS_KEY: z.string().min(32, 'ROOT_SECRET_ACCESS_KEY must be at least 32 characters'),
      OPENBUCKET_ENDPOINT: z.string().regex(/^[a-z0-9.-]+$/, 'OPENBUCKET_ENDPOINT must be a DNS-safe hostname').optional(),
      OPENBUCKET_REGION: z.string().default('us-east-1'),
      MAX_OBJECT_SIZE_MB: z.coerce.number().int().positive().max(5_242_880).default(5_120_000),
      MAX_MULTIPART_PARTS: z.coerce.number().int().positive().max(10_000).default(10_000),
      MULTIPART_TTL_HOURS: z.coerce.number().int().positive().default(24),
      SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    })
    .strict();
  export type Env = z.infer<typeof EnvSchema>;
  ```
- §1.7 final paragraph (line 816) calls out the five no-default vars (`DATA_DIR`, `JWT_SECRET`, `ROOT_ACCESS_KEY_ID`, `ROOT_SECRET_ACCESS_KEY`, `ADMIN_PASSWORD_HASH`).

## Acceptance criteria
- [ ] Schema includes all 17 keys from §1.7 with exact constraints and defaults.
- [ ] Schema is `.strict()` — unknown env vars fail validation.
- [ ] `Env` type alias is exported via `z.infer<typeof EnvSchema>`.

## Test obligations
- Unit: covered by [TEST-0012]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.7 (lines 706–781)
