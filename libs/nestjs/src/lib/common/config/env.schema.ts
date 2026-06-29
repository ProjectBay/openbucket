import { z } from 'zod';

const portNumber = z.coerce.number().int().min(1).max(65_535);

export const EnvSchema = z
  .object({
    // --- runtime ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: portNumber.default(9000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // --- persistence ---
    DATA_DIR: z
      .string()
      .min(1, 'DATA_DIR must be set to a host-mounted directory')
      .refine((p) => !p.endsWith('/'), 'DATA_DIR must not have a trailing slash'),

    // --- admin auth ---
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900), // 15m
    JWT_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3600)
      .max(2_592_000)
      .default(604_800), // 7d
    ADMIN_USERNAME: z.string().min(1).default('admin'),
    ADMIN_PASSWORD_HASH: z
      .string()
      .regex(/^\$argon2id\$/, 'ADMIN_PASSWORD_HASH must be an argon2id hash'),

    // --- s3 protocol ---
    ROOT_ACCESS_KEY_ID: z
      .string()
      .regex(/^[A-Z0-9]{16,32}$/, 'ROOT_ACCESS_KEY_ID must be 16-32 uppercase alphanumerics'),
    ROOT_SECRET_ACCESS_KEY: z
      .string()
      .min(32, 'ROOT_SECRET_ACCESS_KEY must be at least 32 characters'),
    OPENBUCKET_ENDPOINT: z
      .string()
      .regex(/^[a-z0-9.-]+$/, 'OPENBUCKET_ENDPOINT must be a DNS-safe hostname')
      .optional(),
    OPENBUCKET_REGION: z.string().default('us-east-1'),
    // Optional backend SSE-S3 key: base64 of exactly 32 bytes. When unset, the
    // key is generated + persisted to <DATA_DIR>/sse.key on first boot (STORY-0122).
    OPENBUCKET_SSE_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'OPENBUCKET_SSE_KEY must be base64 of 32 bytes')
      .optional(),

    // --- limits ---
    MAX_OBJECT_SIZE_MB: z.coerce.number().int().positive().max(5_242_880).default(5_120_000), // 5 TiB
    MAX_MULTIPART_PARTS: z.coerce.number().int().positive().max(10_000).default(10_000),
    MULTIPART_TTL_HOURS: z.coerce.number().int().positive().default(24),

    // --- shutdown ---
    SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  });
// NOTE (white-paper §1.7 correction): the spec called for `.strict()`, but
// `ConfigModule.forRoot({ validate: loadEnv })` runs validation against the
// *entire* process.env — which on any real host carries hundreds of unrelated
// OS variables (PATH, APPDATA, …). A strict schema rejects all of them and the
// app can never boot. Default `z.object` behaviour (strip unknown keys) is the
// only workable choice when validating process.env. Unknown OpenBucket-specific
// keys are therefore silently ignored rather than erroring.

export type Env = z.infer<typeof EnvSchema>;

/**
 * Used by ConfigModule.forRoot({ validate }). Throws on failure; Nest converts
 * the throw into a fatal boot error.
 */
export function loadEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    throw new Error('Refusing to boot: invalid environment.');
  }
  return result.data;
}
