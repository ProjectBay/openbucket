// Runtime configuration, read once from the environment at startup.

export interface Config {
  port: number;
  dbPath: string;
  /** Docs-site origin allowed to POST pageviews; '*' accepts any origin. */
  allowedOrigin: string;
  /** Bearer token required to read /stats; null ⇒ stats endpoint disabled. */
  statsToken: string | null;
  /** Raw events older than this many days are pruned nightly. */
  retentionDays: number;
  /** Trust X-Forwarded-For for the client IP (behind a reverse proxy). */
  trustProxy: boolean;
  /** Max accepted beacon body size, in bytes. */
  maxBodyBytes: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(): Config {
  return {
    port: envInt('PORT', 8787),
    dbPath: process.env.DB_PATH ?? './analytics.db',
    allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',
    statsToken: process.env.STATS_TOKEN?.trim() || null,
    retentionDays: envInt('RETENTION_DAYS', 365),
    trustProxy: (process.env.TRUST_PROXY ?? 'true') !== 'false',
    maxBodyBytes: envInt('MAX_BODY_BYTES', 2048),
  };
}
