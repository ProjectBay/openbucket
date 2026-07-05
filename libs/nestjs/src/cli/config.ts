/**
 * CLI configuration resolution (TASK-3610): endpoint + credentials from
 * flags/env with a `flag > env` precedence. The password is intentionally NOT a
 * field and NOT a flag — it is read only from `$OPENBUCKET_PASSWORD` or an
 * interactive prompt (TASK-3611), so it never lands on `argv`/`ps`.
 */

import { usageError } from './errors';

export interface CliConfig {
  /** e.g. `http://127.0.0.1:3900` — trailing slash stripped. */
  endpoint: string;
  username?: string;
  /** `$OPENBUCKET_TOKEN` — when present, login is skipped entirely. */
  token?: string;
  json: boolean;
  quiet: boolean;
  /** Allow a non-loopback plain-`http` endpoint (creds over plaintext). */
  insecure: boolean;
}

/** Parsed flag values relevant to config (a subset of the full arg schema). */
export interface ConfigFlags {
  endpoint?: string;
  username?: string;
  json?: boolean;
  quiet?: boolean;
  insecure?: boolean;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:3900';

function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '127.0.0.1' ||
    host.startsWith('127.')
  );
}

/**
 * Resolve the effective {@link CliConfig}. Throws a usage {@link CliError} when
 * the endpoint is malformed or would send credentials over non-loopback
 * plaintext `http` without `--insecure`.
 */
export function resolveConfig(flags: ConfigFlags, env: NodeJS.ProcessEnv): CliConfig {
  const rawEndpoint = flags.endpoint ?? env.OPENBUCKET_ENDPOINT ?? DEFAULT_ENDPOINT;
  const endpoint = rawEndpoint.replace(/\/+$/, '');

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw usageError(`invalid --endpoint: ${endpoint}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw usageError(`--endpoint must be http(s): ${endpoint}`);
  }

  const insecure = Boolean(flags.insecure);
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !insecure) {
    throw usageError(
      `refusing to send credentials over plaintext http to a non-loopback host (${url.hostname}); use https or pass --insecure`,
    );
  }

  return {
    endpoint,
    username: flags.username ?? env.OPENBUCKET_USERNAME,
    token: env.OPENBUCKET_TOKEN || undefined,
    json: Boolean(flags.json),
    quiet: Boolean(flags.quiet),
    insecure,
  };
}
