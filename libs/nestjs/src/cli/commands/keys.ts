/**
 * `keys` command group (TASK-3612): `list | create | revoke`. The created
 * secret is surfaced exactly ONCE (mirroring the controller contract) as data on
 * stdout, never on a log/error line.
 */

// Type-only — the canonical wire DTOs (the source the api-client is generated
// from). Erased at emit: no runtime, no Angular pulled into the CLI.
import type { CreateKeyDto } from '../../lib/admin/keys/dto/create-key.dto';
import type { CreatedKeyDto } from '../../lib/admin/keys/dto/created-key.dto';
import type { KeySummaryDto } from '../../lib/admin/keys/dto/key-summary.dto';
import type { KeyScope, KeyScopeView } from '../../lib/domain/keys/key-scope';

import type { CliConfig } from '../config';
import { EXIT, usageError } from '../errors';
import { request } from '../http-client';
import { printJson, printKeyValue, printLine, printNotice, printTable } from '../output';
import { acquireToken } from '../session';

/** Mirror of the bucket-name rule for validating the scope's bucket locally. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** Render a scope object as a compact one-line summary for the table. */
function summarizeScope(scope: KeyScopeView | null | undefined): string {
  if (!scope) return '(root)';
  if (scope.kind === 'prefix') {
    return `prefix:${scope.bucket ?? ''}/${scope.prefix ?? ''}`;
  }
  return scope.kind;
}

/**
 * Parse the `--scope prefix:<bucket>/<prefix>` shorthand into the
 * `CreateKeyDtoScope` union the controller expects. Rejects a malformed shape
 * client-side (usage error) rather than sending a body the DTO would 400 on.
 */
function parseScope(raw: string): KeyScope {
  const m = /^prefix:([^/]+)(?:\/(.*))?$/.exec(raw);
  if (!m) throw usageError('--scope must be of the form prefix:<bucket>/<prefix>');
  const bucket = m[1];
  const prefix = m[2] ?? '';
  if (!BUCKET_NAME.test(bucket)) {
    throw usageError(`invalid scope bucket "${bucket}": must match S3 naming rules`);
  }
  const scope: { kind: 'prefix'; bucket: string; prefix?: string } = { kind: 'prefix', bucket };
  if (prefix) scope.prefix = prefix;
  return scope;
}

async function list(cfg: CliConfig): Promise<number> {
  const token = await acquireToken(cfg);
  const rows = await request<KeySummaryDto[]>(cfg, 'GET', '/api/admin/keys', { token });

  if (cfg.json) {
    printJson(rows);
    return EXIT.SUCCESS;
  }
  if (cfg.quiet) {
    for (const k of rows) printLine(k.id);
    return EXIT.SUCCESS;
  }

  printTable(rows, [
    { header: 'ID', get: (k) => k.id },
    { header: 'ACCESS-KEY-ID', get: (k) => k.accessKeyId },
    { header: 'LABEL', get: (k) => k.label },
    { header: 'ROLE', get: (k) => k.role },
    { header: 'DISABLED', get: (k) => (k.disabled ? 'yes' : 'no') },
    { header: 'SCOPE', get: (k) => summarizeScope(k.scope) },
    { header: 'LAST-USED', get: (k) => k.lastUsedAt ?? 'never' },
  ]);
  return EXIT.SUCCESS;
}

async function create(cfg: CliConfig, flags: { label?: string; scope?: string }): Promise<number> {
  // Validate label + scope shorthand locally BEFORE acquiring a token.
  if (!flags.label) throw usageError('usage: keys create --label <l> [--scope prefix:<bucket>/<prefix>]');

  const body: CreateKeyDto = { label: flags.label };
  if (flags.scope) body.scope = parseScope(flags.scope);

  const token = await acquireToken(cfg);
  const created = await request<CreatedKeyDto>(cfg, 'POST', '/api/admin/keys', { token, body });

  // Under --json, emit the raw DTO so the secret is delivered once, machine-readably.
  if (cfg.json) {
    printJson(created);
    return EXIT.SUCCESS;
  }

  // The secretAccessKey is DATA on stdout — the ONLY place a secret is printed.
  printKeyValue([
    ['id', created.id],
    ['accessKeyId', created.accessKeyId],
    ['secretAccessKey', created.secretAccessKey],
    ['role', created.role],
    ['scope', summarizeScope(created.scope)],
  ]);
  if (!cfg.quiet) {
    printNotice('store the secretAccessKey now — it is not shown again.');
  }
  return EXIT.SUCCESS;
}

async function revoke(cfg: CliConfig, id: string | undefined): Promise<number> {
  if (!id) throw usageError('usage: keys revoke <id>');
  const token = await acquireToken(cfg);
  // The server maps a missing key to 404 "key <id> not found", surfaced by the
  // transport's error mapping.
  const revoked = await request<KeySummaryDto>(
    cfg,
    'POST',
    `/api/admin/keys/${encodeURIComponent(id)}/revoke`,
    { token },
  );

  if (cfg.json) {
    printJson(revoked);
    return EXIT.SUCCESS;
  }
  printLine(cfg.quiet ? revoked.id : `revoked key ${revoked.id} (${revoked.label})`);
  return EXIT.SUCCESS;
}

/** Dispatch a `keys` subcommand. `rest` is the positional tail after `keys`. */
export async function runKeys(cfg: CliConfig, rest: string[], flags: { label?: string; scope?: string }): Promise<number> {
  const sub = rest[0];
  if (!sub) throw usageError('usage: keys <list|create|revoke> [args]');

  // Each handler acquires the token only AFTER its own local validation.
  switch (sub) {
    case 'list':
      return list(cfg);
    case 'create':
      return create(cfg, flags);
    case 'revoke':
      return revoke(cfg, rest[1]);
    default:
      throw usageError(`unknown keys subcommand "${sub}" (expected list|create|revoke)`);
  }
}
