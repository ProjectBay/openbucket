import type { ModuleMetadata, Type } from '@nestjs/common';
import { z } from 'zod';

import {
  normalizeMount,
  S3_BUCKET_RE,
  strongSecret,
  validateCronExpression,
  validateReplicationEndpoint,
  validateWebhookUrl,
} from './common/config/env.schema';

// Re-exported for the existing import sites (open-bucket.module.ts, tests) that
// pull `normalizeMount` from here. It now lives in `env.schema` so the standalone
// `MOUNT_PATH` env var can share it without a config → options import cycle.
export { normalizeMount };

/**
 * Configuration for {@link OpenBucketModule}. Replaces the standalone app's
 * env-var/refuse-to-boot config — a host NestJS app passes these in code.
 */
export interface OpenBucketModuleOptions {
  /**
   * Directory for the SQLite metadata DB + blob payloads (and the generated
   * `sse.key`). Created on boot if absent.
   */
  dataDir: string;

  /**
   * Route prefix under which ALL OpenBucket routes mount (S3 wire protocol,
   * admin JSON API, and the admin SPA). Default `/storage`. The S3 endpoint a
   * client points at is `http(s)://<host>[:port]<mountPath>` (path-style only —
   * virtual-host-style addressing is not supported in library mode).
   */
  mountPath?: string;

  /** Root S3 credentials (SigV4). Single-tenant in v1. */
  rootCredentials: { accessKeyId: string; secretAccessKey: string };

  /** Bucket region reported to clients. Default `us-east-1`. */
  region?: string;

  /**
   * DNS-safe hostname clients use to reach this store (endpoint discovery /
   * redirects). Optional; path-style works without it.
   */
  endpoint?: string;

  /**
   * Backend SSE-S3 key (base64 of 32 bytes) for at-rest encryption. When omitted,
   * a key is generated and persisted to `<dataDir>/sse.key` (STORY-0122).
   */
  sseKey?: string;

  /** Admin console (JSON API + bundled SPA). Omit to disable the admin surface entirely. */
  admin?: {
    username: string;
    /**
     * argon2id hash of the admin password. Provide this OR `password` (one of the
     * two is required when `admin` is present).
     */
    passwordHash?: string;
    /**
     * Plaintext admin password — the convenience alternative to `passwordHash`.
     * OpenBucket argon2id-hashes it on first boot (seed-once) and never logs it.
     * Prefer `passwordHash` for production. Ignored when `passwordHash` is set.
     */
    password?: string;
    /** Secret for signing admin JWTs. */
    jwtSecret: string;
    /** Serve the bundled Angular SPA at `<mountPath>/admin`. Default `true`. */
    serveUi?: boolean;
    /** Access-token TTL (seconds). Default 900 (15 min). */
    jwtAccessTtl?: number;
    /** Refresh-token TTL (seconds). Default 604800 (7 days). */
    jwtRefreshTtl?: number;
  };

  /** Limits. */
  limits?: {
    /** Max single-object size in MiB. Default 5_120_000 (≈5 TiB). */
    maxObjectSizeMb?: number;
    /** Max parts per multipart upload. Default 10_000. */
    maxMultipartParts?: number;
    /** Abandoned-multipart TTL in hours. Default 24. */
    multipartTtlHours?: number;
  };

  /**
   * Durable, signed object-event webhooks (STORY-0801). Omit to disable webhook
   * delivery entirely (in-process `@OnObject*` handlers still work). Presence of
   * `url` enables the transactional outbox + the delivery runner.
   */
  webhooks?: {
    /** Target endpoint. `https` required unless the host is loopback. */
    url: string;
    /** HMAC-SHA256 signing key — validated by `strongSecret()` at boot. */
    secret: string;
    /** Event filter. Default: all three. */
    events?: Array<'object.created' | 'object.deleted' | 'multipart.completed'>;
    /** Max delivery attempts before dead-letter. Default 8. */
    maxAttempts?: number;
    /** Per-request timeout (ms). Default 5000. */
    timeoutMs?: number;
    /** Delivery tick interval (ms). Default 15000. */
    pollMs?: number;
  };

  /**
   * Async one-way replication of the current visible object state to an external
   * S3-compatible target (STORY-0900) — R2 / B2 / MinIO / AWS S3. Omit to disable
   * replication entirely (the outbox stays empty and the drain worker no-ops).
   * Every committed PUT/DELETE enqueues a durable intent in the same transaction;
   * a background worker drains it with per-key ordering, retry/backoff, and a
   * dead-letter cap. NOTE: the worker sends object PLAINTEXT (SSE decrypted), so
   * prefer an `https` endpoint — an `http` endpoint logs a boot-time warning.
   */
  replication?: {
    /** S3-compatible endpoint (R2/B2/MinIO). Omit for real AWS S3. */
    endpoint?: string;
    /** Target region. Default `us-east-1`. */
    region?: string;
    /** Remote target bucket (must already exist). */
    bucket: string;
    /** Target credentials. */
    credentials: { accessKeyId: string; secretAccessKey: string };
    /** Path-style addressing — true for MinIO/S3-compat, false for AWS. Default true. */
    forcePathStyle?: boolean;
    /** Max attempts before an intent is dead-lettered. Default 12. */
    maxAttempts?: number;
    /** Drain tick interval (ms). Default 5000. */
    drainIntervalMs?: number;
    /** Distinct keys drained per tick. Default 50. */
    batchKeys?: number;
    /** Objects larger than this stream via multipart. Default 64 MiB. */
    largeObjectThresholdBytes?: number;
  };

  /**
   * Scheduled backups & retention (STORY-1203). Omit to disable — no snapshot
   * runs and the runner is a no-op. When present, a background tick writes a
   * `.zip` snapshot (identical to the admin download) to `dir` on the configured
   * schedule, prunes old snapshots by the retention policy, and (optionally)
   * pushes the snapshot to the replication target. Exactly one of `cron` /
   * `intervalMinutes` must be set (validated at boot). NOTE: snapshots contain
   * decrypted plaintext object bytes — `dir` inherits the data volume's trust
   * boundary (written `0o600` under a `0o700` dir).
   */
  backups?: {
    /** `instance` (default) = one whole-instance snapshot; `buckets` = one per bucket. */
    scope?: 'instance' | 'buckets';
    /** 5-field cron schedule — validated at boot. Mutually exclusive with `intervalMinutes`. */
    cron?: string;
    /** Fixed interval between snapshots (minutes). Mutually exclusive with `cron`. */
    intervalMinutes?: number;
    /** Absolute snapshot directory. Default `<dataDir>/backups`. */
    dir?: string;
    /** Keep the newest N snapshots (a hard retention floor). Default 7. */
    keepLast?: number;
    /** Also keep anything younger than this many days (union). Default 30. */
    maxAgeDays?: number;
    /** Wake tick (ms) — how often to check whether a snapshot is due. Default 60000. */
    checkIntervalMs?: number;
    /** Push each finished snapshot to the replication target. Default false. */
    pushToReplication?: boolean;
  };

  /**
   * Prometheus scrape endpoint at `<mountPath>/metrics` (STORY-1202). Default
   * `off` — the endpoint serves nothing (falls through to the S3 route, no
   * registry body leaked). `public` serves an unauthenticated scrape (a trusted
   * network); `token` requires `Authorization: Bearer <token>` and the token
   * must be strong (validated at boot).
   */
  metrics?: {
    mode?: 'off' | 'public' | 'token';
    /** Bearer token — required (and validated strong) when `mode: 'token'`. */
    token?: string;
  };

  /**
   * OpenTelemetry tracing (STORY-1202). Default disabled. When enabled the
   * library wraps request handling in a span — but ONLY if the host installs
   * `@opentelemetry/api` (an optional peer) and registers an SDK; otherwise it
   * is a hard no-op. The library never hard-depends on any `@opentelemetry/*`
   * package.
   */
  tracing?: { enabled?: boolean };
}

/** Async variant for DI'd secrets (e.g. from the host's ConfigService). */
export interface OpenBucketModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Route prefix — must be STATIC (known at module-config time, before the async
   * factory runs, because routing is wired then). Default `/storage`.
   */
  mountPath?: string;
  /**
   * Serve the bundled admin SPA at `<mountPath>/admin` — STATIC (routing is wired at
   * config time, so this can't come from the async factory). Default `true`.
   */
  serveUi?: boolean;
  /**
   * Whether the admin surface (JSON API + JWT guard + first-run bootstrap + SPA)
   * exists at all — STATIC, since the routes are wired at config time. Default
   * `true`. When `true`, the async factory MUST return an `admin` block; pass
   * `false` to run a headless, S3-only store.
   */
  admin?: boolean;
  useFactory: (...args: unknown[]) => Promise<OpenBucketModuleOptions> | OpenBucketModuleOptions;
  inject?: Array<Type<unknown> | string | symbol>;
}

/** DI token carrying the fully-resolved (defaults-applied) options. */
export const OPEN_BUCKET_OPTIONS = Symbol('OPEN_BUCKET_OPTIONS');

/** Fully-resolved options (all defaults applied). The single shape the lib reads. */
export interface ResolvedOpenBucketOptions {
  dataDir: string;
  mountPath: string;
  region: string;
  endpoint?: string;
  sseKey?: string;
  rootCredentials: { accessKeyId: string; secretAccessKey: string };
  admin?: {
    username: string;
    passwordHash?: string;
    password?: string;
    jwtSecret: string;
    serveUi: boolean;
    jwtAccessTtl: number;
    jwtRefreshTtl: number;
  };
  limits: {
    maxObjectSizeMb: number;
    maxMultipartParts: number;
    multipartTtlHours: number;
  };
  webhooks?: {
    url: string;
    secret: string;
    events?: Array<'object.created' | 'object.deleted' | 'multipart.completed'>;
    maxAttempts?: number;
    timeoutMs?: number;
    pollMs?: number;
  };
  replication?: {
    endpoint?: string;
    region?: string;
    bucket: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    forcePathStyle?: boolean;
    maxAttempts?: number;
    drainIntervalMs?: number;
    batchKeys?: number;
    largeObjectThresholdBytes?: number;
  };
  backups?: {
    scope?: 'instance' | 'buckets';
    cron?: string;
    intervalMinutes?: number;
    dir?: string;
    keepLast?: number;
    maxAgeDays?: number;
    checkIntervalMs?: number;
    pushToReplication?: boolean;
  };
  metrics: {
    mode: 'off' | 'public' | 'token';
    token?: string;
  };
  tracing: {
    enabled: boolean;
  };
}

const DEFAULT_MOUNT = '/storage';

/** Apply defaults + light validation. */
export function resolveOptions(o: OpenBucketModuleOptions): ResolvedOpenBucketOptions {
  if (!o?.dataDir) throw new Error('OpenBucketModule: `dataDir` is required');
  if (!o.rootCredentials?.accessKeyId || !o.rootCredentials?.secretAccessKey) {
    throw new Error('OpenBucketModule: `rootCredentials` is required');
  }
  // A present-but-partial `admin` block is a footgun: an empty `jwtSecret` would
  // sign admin JWTs with no secret. Require `username`, `jwtSecret`, and a
  // credential (`passwordHash` OR `password`) — or omit `admin` to disable the
  // admin surface.
  if (
    o.admin &&
    (!o.admin.username || (!o.admin.passwordHash && !o.admin.password) || !o.admin.jwtSecret)
  ) {
    throw new Error(
      'OpenBucketModule: `admin` requires non-empty `username`, `jwtSecret`, and either ' +
        '`passwordHash` (argon2id) or `password` (plaintext, hashed at boot). Omit `admin` ' +
        'entirely to disable the admin surface.',
    );
  }
  return {
    dataDir: o.dataDir,
    mountPath: normalizeMount(o.mountPath ?? DEFAULT_MOUNT),
    region: o.region ?? 'us-east-1',
    endpoint: o.endpoint,
    sseKey: o.sseKey,
    rootCredentials: o.rootCredentials,
    admin: o.admin
      ? {
          username: o.admin.username,
          passwordHash: o.admin.passwordHash,
          password: o.admin.password,
          jwtSecret: o.admin.jwtSecret,
          serveUi: o.admin.serveUi ?? true,
          jwtAccessTtl: o.admin.jwtAccessTtl ?? 900,
          jwtRefreshTtl: o.admin.jwtRefreshTtl ?? 604_800,
        }
      : undefined,
    limits: {
      // Default 5 GiB — matches the standalone env default (MAX_OBJECT_SIZE_MB).
      // The former 5 TiB default was an unbounded-allocation footgun (CWE-770);
      // an embedder raises it explicitly if they really need larger objects.
      maxObjectSizeMb: o.limits?.maxObjectSizeMb ?? 5_120,
      maxMultipartParts: o.limits?.maxMultipartParts ?? 10_000,
      multipartTtlHours: o.limits?.multipartTtlHours ?? 24,
    },
    // Pass the webhooks block through as-is (numeric defaults are applied in
    // config-source when mapping to the env-shaped config). `undefined` keeps
    // webhooks disabled.
    webhooks: o.webhooks,
    // Replication block passed through as-is (defaults applied in config-source).
    // `undefined` keeps replication disabled. A present-but-partial block is a
    // footgun: require the bucket + both credentials, or omit `replication`.
    replication: o.replication
      ? (() => {
          if (
            !o.replication.bucket ||
            !o.replication.credentials?.accessKeyId ||
            !o.replication.credentials?.secretAccessKey
          ) {
            throw new Error(
              'OpenBucketModule: `replication` requires a non-empty `bucket` and ' +
                '`credentials.accessKeyId` / `credentials.secretAccessKey`. Omit ' +
                '`replication` entirely to disable replication.',
            );
          }
          return o.replication;
        })()
      : undefined,
    // Scheduled backups (STORY-1203). Passed through as-is (numeric defaults +
    // the `<dataDir>/backups` default dir are applied in config-source when
    // mapping to the env-shaped config). `undefined` keeps backups disabled. The
    // cron/interval mutual-exclusion + cron syntax are enforced by
    // `validateSecurityCriticalOptions` so an embedder gets the same fail-fast.
    backups: o.backups,
    // Prometheus /metrics (STORY-1202). Default `off`; the token (when mode is
    // `token`) is format-validated by `validateSecurityCriticalOptions`.
    metrics: {
      mode: o.metrics?.mode ?? 'off',
      token: o.metrics?.token,
    },
    // OpenTelemetry tracing (STORY-1202). Default disabled.
    tracing: {
      enabled: o.tracing?.enabled ?? false,
    },
  };
}

/**
 * Fail-fast validation of the security-critical option **formats** (beyond the
 * presence checks in {@link resolveOptions}). Mirrors the corresponding subset
 * of `common/config/env.schema.ts` — the standalone app's refuse-to-boot schema
 * — so an embedder gets the same guarantee at boot instead of a silent
 * misconfiguration that only surfaces later: a non-argon2id `passwordHash` or a
 * too-short `jwtSecret` at first admin login, a too-short secret key at the
 * first signed S3 request.
 *
 * Intentionally does **not** enforce the AWS-shaped `ROOT_ACCESS_KEY_ID` regex
 * (`^[A-Z0-9]{16,32}$`): library callers may use arbitrary access-key strings
 * (the SigV4 verifier compares them literally), so requiring the AWS format
 * would be a needless breaking constraint on host apps. See `config-source.ts`.
 */
export function validateSecurityCriticalOptions(o: ResolvedOpenBucketOptions): void {
  const schema = z.object({
    rootCredentials: z.object({
      secretAccessKey: strongSecret('rootCredentials.secretAccessKey'),
    }),
    sseKey: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'sseKey must be base64 of 32 bytes')
      .optional(),
    admin: z
      .object({
        jwtSecret: strongSecret('admin.jwtSecret'),
        // Either an argon2id hash OR a plaintext password (hashed at boot) — the
        // refine below requires at least one, mirroring resolveOptions + the env
        // schema. Without making `passwordHash` optional here, a `password`-only
        // admin block (a supported config) would throw at boot.
        passwordHash: z
          .string()
          .regex(/^\$argon2id\$/, 'admin.passwordHash must be an argon2id hash')
          .optional(),
        password: z
          .string()
          .min(8, 'admin.password must be at least 8 characters')
          .optional(),
      })
      .refine((a) => !!a.passwordHash || !!a.password, {
        message: 'admin requires either `passwordHash` (argon2id) or `password` (>= 8 chars)',
        path: ['passwordHash'],
      })
      .optional(),
    // When a webhook URL is configured, the HMAC secret must be strong and the
    // URL must be https (or loopback) — same fail-closed contract as
    // admin.jwtSecret / rootCredentials.secretAccessKey (STORY-0801, EPIC-08).
    webhooks: z
      .object({
        url: z.string().superRefine((u, ctx) => {
          const err = validateWebhookUrl(u);
          if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
        }),
        secret: strongSecret('webhooks.secret'),
      })
      .optional(),
    // Replication (STORY-0900): a malformed endpoint or bucket name fails at boot
    // rather than at first drain. The endpoint scheme (http warning) is handled
    // at runtime in the REPLICATION_CONFIG factory — not a hard failure here.
    replication: z
      .object({
        bucket: z
          .string()
          .regex(S3_BUCKET_RE, 'replication.bucket must be a valid S3 bucket name (3-63 chars)'),
        endpoint: z
          .string()
          .optional()
          .superRefine((e, ctx) => {
            if (!e) return;
            const { error } = validateReplicationEndpoint(e);
            if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
          }),
      })
      .optional(),
    // Scheduled backups (STORY-1203): exactly one of cron / intervalMinutes,
    // and a cron expression must parse — same fail-fast boot guarantee the
    // standalone env schema gives (never a schedule that silently never fires or
    // throws mid-tick).
    backups: z
      .object({
        cron: z.string().optional(),
        intervalMinutes: z.number().int().min(5).max(43_200).optional(),
      })
      .passthrough()
      .superRefine((b, ctx) => {
        const hasInterval = b.intervalMinutes != null;
        const hasCron = typeof b.cron === 'string' && b.cron !== '';
        if (hasInterval === hasCron) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'exactly one of `backups.cron` or `backups.intervalMinutes` must be set',
          });
        }
        if (hasCron) {
          const err = validateCronExpression(b.cron as string);
          if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cron'], message: err });
        }
      })
      .optional(),
    // Prometheus /metrics (STORY-1202): a `token` mode must carry a strong
    // bearer token — same fail-closed contract as admin.jwtSecret /
    // webhooks.secret. A `token` mode with a weak/empty token must fail at boot,
    // not silently expose metrics.
    metrics: z
      .object({
        mode: z.enum(['off', 'public', 'token']),
        token: z.string().optional(),
      })
      .superRefine((m, ctx) => {
        if (m.mode !== 'token') return;
        const result = strongSecret('metrics.token').safeParse(m.token);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['token'], message: issue.message });
          }
        }
      }),
  });
  const result = schema.safeParse(o);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`OpenBucketModule: invalid configuration (fix before boot):\n${issues}`);
  }
}
