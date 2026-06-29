import type { ModuleMetadata, Type } from '@nestjs/common';

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
    /** argon2id hash of the admin password. */
    passwordHash: string;
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
    passwordHash: string;
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
}

const DEFAULT_MOUNT = '/storage';

/** Apply defaults + light validation. */
export function resolveOptions(o: OpenBucketModuleOptions): ResolvedOpenBucketOptions {
  if (!o?.dataDir) throw new Error('OpenBucketModule: `dataDir` is required');
  if (!o.rootCredentials?.accessKeyId || !o.rootCredentials?.secretAccessKey) {
    throw new Error('OpenBucketModule: `rootCredentials` is required');
  }
  // A present-but-partial `admin` block is a footgun: an empty `jwtSecret` would
  // sign admin JWTs with no secret. Require all three fields, or omit `admin`
  // entirely to disable the admin surface.
  if (o.admin && (!o.admin.username || !o.admin.passwordHash || !o.admin.jwtSecret)) {
    throw new Error(
      'OpenBucketModule: `admin` requires non-empty `username`, `passwordHash`, and ' +
        '`jwtSecret`. Omit `admin` entirely to disable the admin surface.',
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
          jwtSecret: o.admin.jwtSecret,
          serveUi: o.admin.serveUi ?? true,
          jwtAccessTtl: o.admin.jwtAccessTtl ?? 900,
          jwtRefreshTtl: o.admin.jwtRefreshTtl ?? 604_800,
        }
      : undefined,
    limits: {
      maxObjectSizeMb: o.limits?.maxObjectSizeMb ?? 5_120_000,
      maxMultipartParts: o.limits?.maxMultipartParts ?? 10_000,
      multipartTtlHours: o.limits?.multipartTtlHours ?? 24,
    },
  };
}

/** Leading slash, no trailing slash; `''` (root) allowed. */
export function normalizeMount(p: string): string {
  let m = p.trim();
  if (m === '/' || m === '') return '';
  if (!m.startsWith('/')) m = `/${m}`;
  return m.replace(/\/+$/, '');
}
