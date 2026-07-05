/**
 * Shared CLI error type, exit-code map, and the central secret-redactor
 * (TASK-3611 + TASK-3614).
 *
 * Every human-facing error the CLI prints flows through {@link CliError.toStderr}
 * (or {@link redact} directly), so bearer tokens / JWTs / `secretAccessKey` /
 * `password` values can never leak to stderr — preserving the EPIC-08
 * secret-redaction posture (the same reason `/metrics` never leaks secrets).
 */

/** Process exit codes returned by `runCli` and applied only by `index.ts`. */
export const EXIT = {
  SUCCESS: 0,
  ERROR: 1, // generic / runtime error
  USAGE: 2, // bad args / unknown command
  AUTH: 3, // 401
  RATE_LIMIT: 4, // 429
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * Strip anything secret-shaped from a string before it reaches stderr:
 *  - `Bearer <token>` authorization values,
 *  - JWT-looking `eyJ…` triples,
 *  - any `secretAccessKey` / `password` field value (JSON `"k":"v"`, `k=v`, `k: v`).
 *
 * Applied by construction on every error path (see {@link CliError.toStderr}),
 * so no call site can forget it.
 */
export function redact(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[REDACTED]')
    .replace(
      /((?:secretAccessKey|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      '$1[REDACTED]',
    );
}

/**
 * A CLI error carrying the process exit code to apply. `toStderr()` returns the
 * message already run through {@link redact} — the only sanctioned way to print
 * an error message.
 */
export class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode = EXIT.ERROR) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }

  /** Redacted, single-line message safe to write to stderr. */
  toStderr(): string {
    return redact(this.message);
  }
}

/** Convenience constructor for a usage (exit 2) error. */
export function usageError(message: string): CliError {
  return new CliError(message, EXIT.USAGE);
}

/**
 * Map a non-2xx `Response` to a typed {@link CliError}. Reads the admin exception
 * filter's JSON error shape (`{ error, message, statusCode }`) when present, but
 * NEVER echoes request headers (which carry the bearer token). `401`→"invalid
 * credentials" (exit 3); `429`→a rate-limit message with `Retry-After` and NO
 * auto-retry (exit 4).
 */
export async function fromResponse(res: Response): Promise<CliError> {
  const status = res.status;

  if (status === 401) {
    return new CliError('invalid credentials', EXIT.AUTH);
  }

  if (status === 429) {
    const retryAfter = res.headers.get('retry-after');
    const wait = retryAfter ? `${retryAfter}s` : '≤60s';
    return new CliError(
      `rate limited by the server — try again in ${wait}`,
      EXIT.RATE_LIMIT,
    );
  }

  let serverMessage = '';
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    if (body && typeof body === 'object') {
      const m = body.message ?? body.error;
      if (typeof m === 'string') serverMessage = m;
      else if (Array.isArray(m)) serverMessage = m.map(String).join('; ');
    }
  } catch {
    // Non-JSON / empty body — fall through to the generic message.
  }

  const message = serverMessage || `request failed with HTTP ${status}`;
  return new CliError(message, EXIT.ERROR);
}
