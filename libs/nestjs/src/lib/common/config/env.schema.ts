import { z } from 'zod';

const portNumber = z.coerce.number().int().min(1).max(65_535);

/**
 * Case-insensitive denylist of well-known placeholder / example secrets. A 32+
 * char value that is one of these boots cleanly under a bare `.min(32)` but is
 * trivially guessable, so it is refused (CWE-521). Kept small and high-signal to
 * avoid false rejections of legitimate high-entropy secrets.
 */
export const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'change-me',
  'please-change-me',
  'secret',
  'password',
  'passphrase',
  'default',
  'example',
  'insecure',
]);

/**
 * Length floor plus a cheap, low-false-positive low-entropy / placeholder guard
 * for security-critical HMAC/secret keys (JWT_SECRET, ROOT_SECRET_ACCESS_KEY).
 * Rejects all-identical strings, known placeholders, and values with too few
 * distinct characters. Generate a strong value with `openssl rand -base64 48`.
 */
export const strongSecret = (label: string) =>
  z
    .string()
    .min(32, `${label} must be at least 32 characters`)
    .refine((v) => !/^(.)\1+$/.test(v), `${label} must not be a single repeated character`)
    .refine(
      (v) => !PLACEHOLDER_SECRETS.has(v.toLowerCase()),
      `${label} must not be a known placeholder value`,
    )
    .refine((v) => new Set(v).size >= 8, `${label} has too few distinct characters`);

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
    JWT_SECRET: strongSecret('JWT_SECRET'),
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
    ROOT_SECRET_ACCESS_KEY: strongSecret('ROOT_SECRET_ACCESS_KEY'),
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
    // Per-object size cap. Default 5 GiB (was 5 TiB — an unbounded-allocation
    // footgun, TASK-2140/CWE-770); operators raise it explicitly if they need to.
    MAX_OBJECT_SIZE_MB: z.coerce.number().int().positive().max(5_242_880).default(5_120), // 5 GiB
    MAX_MULTIPART_PARTS: z.coerce.number().int().positive().max(10_000).default(10_000),
    MULTIPART_TTL_HOURS: z.coerce.number().int().positive().default(24),

    // --- storage quota / free-space guard (TASK-2140, CWE-770) ---
    // Refuse writes once the DATA_DIR volume has less than this many bytes free,
    // so a credential holder can't fill the disk shared with the SQLite metadata
    // DB and deny the whole instance. Default 100 MiB reserve.
    DATA_DIR_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(100 * 1024 * 1024),
    // Optional aggregate quotas (0 = disabled): total stored bytes / object count.
    STORAGE_QUOTA_BYTES: z.coerce.number().int().nonnegative().default(0),
    STORAGE_QUOTA_OBJECTS: z.coerce.number().int().nonnegative().default(0),
    // Cap concurrent in-flight multipart sessions (staging amplifier). 0 = unlimited.
    MAX_CONCURRENT_MULTIPART_UPLOADS: z.coerce.number().int().nonnegative().default(1_000),

    // --- S3 API rate limit (TASK-2141, CWE-770) — defence-in-depth ---
    // Per-IP token bucket applied to the S3 data plane. Generous vs the admin
    // 100/min so legitimate high-throughput clients aren't broken; 0 disables it.
    S3_THROTTLE_LIMIT: z.coerce.number().int().nonnegative().default(1_000),
    S3_THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),

    // --- restore decompression caps (TASK-2143/2144, CWE-409/400) ---
    // Total decompressed payload bytes accepted from a restore archive.
    RESTORE_MAX_TOTAL_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024 * 1024), // 100 GiB
    // Per-entry decompressed byte cap.
    RESTORE_MAX_ENTRY_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024 * 1024), // 5 GiB
    // Max number of payload entries in a restore archive.
    RESTORE_MAX_ENTRIES: z.coerce.number().int().positive().default(1_000_000),
    // Max bytes read for the buffered manifest.json entry before aborting (400).
    RESTORE_MAX_MANIFEST_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024), // 4 MiB

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
