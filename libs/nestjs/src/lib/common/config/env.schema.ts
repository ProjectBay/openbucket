import { z } from 'zod';

const portNumber = z.coerce.number().int().min(1).max(65_535);

/**
 * Boolean env coercion that treats the *string* `"false"` (and `"0"`/`"no"`/
 * `"off"`) as `false` — unlike `z.coerce.boolean()`, whose `Boolean("false")`
 * is `true`, which would make a `FLAG=false` kill-switch impossible to disable.
 * Accepts real booleans through, and defaults to `dflt` when the key is absent.
 */
const envBoolean = (dflt: boolean) =>
  z
    .preprocess((v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(s)) return true;
        if (['false', '0', 'no', 'off', ''].includes(s)) return false;
      }
      return v;
    }, z.boolean())
    .default(dflt);

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

/**
 * True when `host` is a loopback address (dev only). A non-https webhook URL is
 * accepted ONLY for loopback so a plaintext delivery can't leak the signature/
 * payload over the network in production (EPIC-08 posture).
 */
export const isLoopbackHost = (host: string): boolean => {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
};

/**
 * Validate a webhook target URL: parseable, and `https:` unless the host is
 * loopback. Returns an error message, or `null` when valid.
 */
export const validateWebhookUrl = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'WEBHOOK_URL must be a valid URL';
  }
  if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
    return 'WEBHOOK_URL must use https (http is allowed only for a loopback host)';
  }
  return null;
};

/**
 * S3 bucket-name syntax (mirrors `BackupService.BUCKET_RE`): 3–63 chars, starts
 * and ends alphanumeric, lowercase letters/digits/dot/hyphen between. Used to
 * fail a malformed remote replication bucket at boot rather than at first drain.
 */
export const S3_BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Validate a replication target endpoint URL. Operator-supplied config (not
 * request input), so this is not an SSRF sink — we only fail fast on a
 * malformed URL. Returns `{ error }` for an unparseable URL, or `{ insecure }`
 * true when the scheme is plaintext `http:` (the caller logs a boot-time warn —
 * replicated bytes are object PLAINTEXT, so an http endpoint leaks contents; not
 * hard-failed because MinIO on a trusted LAN is a legitimate dev case).
 */
export const validateReplicationEndpoint = (
  endpoint: string,
): { error?: string; insecure?: boolean } => {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { error: 'OB_REPLICATION_ENDPOINT must be a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'OB_REPLICATION_ENDPOINT must be an http(s) URL' };
  }
  return { insecure: parsed.protocol === 'http:' };
};

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

    // --- image transforms (STORY-0800) — DoS-bounded on-the-fly derivatives ---
    // Master kill-switch: false makes every GET fall through to the plain path,
    // so an operator who doesn't want the sharp CPU/RAM exposure can disable it.
    IMAGE_TRANSFORM_ENABLED: envBoolean(true),
    // Hard ceiling on requested output width/height (px). Bounds the output
    // canvas. Capped at 16384 so an operator cannot set an unbounded value.
    MAX_TRANSFORM_DIMENSION: z.coerce.number().int().positive().max(16_384).default(4_096),
    // Refuse to transform a source larger than this (bytes) — pre-decode guard.
    MAX_TRANSFORM_INPUT_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024), // 50 MiB
    // sharp limitInputPixels — decoded-canvas ceiling (decompression-bomb guard).
    IMAGE_TRANSFORM_LIMIT_INPUT_PIXELS: z.coerce
      .number()
      .int()
      .positive()
      .default(24_000 * 24_000),
    // Max concurrent sharp operations in-flight (CPU/RAM governor).
    IMAGE_TRANSFORM_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),
    // Derivative cache size ceiling (bytes); GC tick evicts LRU past this.
    // 0 = unbounded (discouraged — the disk-fill backstop is disabled).
    DERIVATIVE_CACHE_MAX_BYTES: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(5 * 1024 * 1024 * 1024), // 5 GiB

    // --- object-event webhooks (STORY-0801) ---
    // Presence of WEBHOOK_URL enables durable, signed webhook delivery. The
    // secret is required (and strong) only when a URL is set — enforced by the
    // superRefine below (Zod field-level `.optional()` can't express the
    // cross-field requirement). Defaults keep webhooks OFF, so pure in-process
    // embedders pay nothing.
    WEBHOOK_URL: z.string().url().optional(),
    WEBHOOK_SECRET: z.string().optional(), // validated by superRefine when URL set
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
    WEBHOOK_POLL_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
    WEBHOOK_EVENTS: z
      .string()
      .default('object.created,object.deleted,multipart.completed'),

    // --- async replication to external S3 target (STORY-0900) ---
    // Off by default: absence ⇒ disabled, so pure local deployments pay nothing.
    // When ENABLED=true the endpoint/bucket/creds are required together (a
    // partial config must refuse to boot) — enforced by the superRefine below.
    OB_REPLICATION_ENABLED: envBoolean(false),
    // S3-compatible endpoint (R2/B2/MinIO). Omit for real AWS S3 (the SDK derives
    // it from the region). http:// is accepted (warned at boot) for LAN dev.
    OB_REPLICATION_ENDPOINT: z.string().optional(),
    OB_REPLICATION_REGION: z.string().default('us-east-1'),
    OB_REPLICATION_BUCKET: z.string().optional(),
    OB_REPLICATION_ACCESS_KEY_ID: z.string().optional(),
    OB_REPLICATION_SECRET_ACCESS_KEY: z.string().optional(),
    // path-style addressing — true for MinIO / other S3-compat; false for AWS.
    OB_REPLICATION_FORCE_PATH_STYLE: envBoolean(true),
    // Dead-letter cap: after this many failed attempts an intent → `failed`.
    OB_REPLICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(12),
    // Drain tick interval (ms). Floor 1000 so the drain can't hot-loop.
    OB_REPLICATION_DRAIN_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(5_000),
    // Distinct keys drained per tick — bounds per-tick work (CWE-770).
    OB_REPLICATION_BATCH_KEYS: z.coerce.number().int().min(1).max(1_000).default(50),
    // Objects larger than this stream via lib-storage multipart. Default 64 MiB.
    OB_REPLICATION_LARGE_OBJECT_THRESHOLD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(64 * 1024 * 1024),

    // --- cold-object tiering (STORY-0901) ---
    // Master switch; still a no-op unless a STORY-0900 remote target is configured.
    OPENBUCKET_TIER_ENABLED: envBoolean(false),
    // Read-through: objects at/under this size are proxied; larger ⇒ presigned redirect.
    OPENBUCKET_TIER_INLINE_MAX_BYTES: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(256 * 1024 * 1024), // 256 MiB
    // Hard latency bound on a proxied remote fetch before returning 503 SlowDown.
    OPENBUCKET_TIER_READTHROUGH_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    // Global cap on concurrent rehydrations (disk + egress amplifier). 0 = unlimited.
    OPENBUCKET_TIER_MAX_CONCURRENT_REHYDRATE: z.coerce.number().int().nonnegative().default(8),
    // TTL for presigned redirect URLs.
    OPENBUCKET_TIER_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    // --- shutdown ---
    SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  })
  .superRefine((env, ctx) => {
    // Cross-field: when replication is enabled, the endpoint (optional for real
    // AWS but validated when present), bucket, and both credentials are required
    // together — a partial config must refuse to boot (mirrors the webhook /
    // admin-block footgun guards, fail-closed).
    if (env.OB_REPLICATION_ENABLED) {
      const requireField = (key: keyof typeof env, label: string) => {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key as string],
            message: `${label} is required when OB_REPLICATION_ENABLED=true`,
          });
        }
      };
      requireField('OB_REPLICATION_BUCKET', 'OB_REPLICATION_BUCKET');
      requireField('OB_REPLICATION_ACCESS_KEY_ID', 'OB_REPLICATION_ACCESS_KEY_ID');
      requireField('OB_REPLICATION_SECRET_ACCESS_KEY', 'OB_REPLICATION_SECRET_ACCESS_KEY');
      if (env.OB_REPLICATION_BUCKET && !S3_BUCKET_RE.test(env.OB_REPLICATION_BUCKET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OB_REPLICATION_BUCKET'],
          message: 'OB_REPLICATION_BUCKET must be a valid S3 bucket name (3-63 chars)',
        });
      }
      if (env.OB_REPLICATION_ENDPOINT) {
        const { error } = validateReplicationEndpoint(env.OB_REPLICATION_ENDPOINT);
        if (error) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OB_REPLICATION_ENDPOINT'], message: error });
        }
      }
    }

    // Cross-field: when a webhook URL is configured, require a strong secret
    // (fail-closed — never sign with a weak/empty key, CWE-521) and enforce the
    // https/loopback rule on the URL.
    if (!env.WEBHOOK_URL) return;
    const secretResult = strongSecret('WEBHOOK_SECRET').safeParse(env.WEBHOOK_SECRET);
    if (!secretResult.success) {
      for (const issue of secretResult.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_SECRET'], message: issue.message });
      }
    }
    const urlError = validateWebhookUrl(env.WEBHOOK_URL);
    if (urlError) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_URL'], message: urlError });
    }
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
