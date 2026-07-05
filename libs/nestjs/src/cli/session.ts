/**
 * Login / JWT session acquisition (TASK-3611).
 *
 * Credentials never touch `argv` or disk: the token is taken from
 * `$OPENBUCKET_TOKEN` when set, otherwise a password from `$OPENBUCKET_PASSWORD`
 * or an interactive (non-echoing) prompt is exchanged for a bearer token via the
 * admin login route. The token lives in memory for the process lifetime only.
 */

// Type-only imports of the canonical wire DTOs. These are the SAME source of
// truth the `@openbucket/api-client` types are generated from; importing them
// type-only keeps the shapes drift-free while pulling ZERO runtime (and, unlike
// the api-client barrel, no Angular) into the CLI's compiled output.
import type { LoginDto } from '../lib/admin/auth/dto/login.dto';
import type { LoginResponseDto } from '../lib/admin/auth/dto/login-response.dto';

import type { CliConfig } from './config';
import { usageError } from './errors';
import { request } from './http-client';
import { promptPassword } from './prompt';

/**
 * Return a usable bearer token. Short-circuits to `$OPENBUCKET_TOKEN` when set
 * (no login call). Login is attempted at most once per invocation — a `429` is
 * surfaced by {@link request} and NOT auto-retried (that would deepen the
 * throttle on the `login` limiter).
 */
export async function acquireToken(cfg: CliConfig): Promise<string> {
  if (cfg.token) return cfg.token;

  if (!cfg.username) {
    throw usageError('a username is required; pass --username or set $OPENBUCKET_USERNAME');
  }

  const password =
    process.env.OPENBUCKET_PASSWORD ?? (await promptPassword(`Password for ${cfg.username}: `));

  const body: LoginDto = { username: cfg.username, password };
  const res = await request<LoginResponseDto>(cfg, 'POST', '/api/admin/auth/login', { body });
  // The rotating refresh cookie is ignored — the CLI is stateless per invocation.
  return res.accessToken;
}
