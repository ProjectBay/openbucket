/**
 * `backup` command group (TASK-3613): `create | restore`. The backup endpoints
 * are binary `.zip` streams excluded from the OpenAPI document, so these call
 * the admin API directly via the transport's streaming helpers. Restore RESETS
 * the target and is gated behind an explicit `--yes` (CI-safe; no TTY confirm).
 */

import type { CliConfig } from '../config';
import { EXIT, usageError } from '../errors';
import { download, upload } from '../http-client';
import { printJson, printLine } from '../output';
import { acquireToken } from '../session';

interface RestoreResult {
  bucketsRestored?: number;
  objectsRestored: number;
}

/** Filesystem-safe timestamp for a default output filename. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function create(
  cfg: CliConfig,
  flags: { bucket?: string; output?: string; force?: boolean },
): Promise<number> {
  const { bucket } = flags;
  const path = bucket
    ? `/api/admin/buckets/${encodeURIComponent(bucket)}/backup`
    : '/api/admin/backup';
  const out =
    flags.output ?? (bucket ? `${bucket}-backup-${timestamp()}.zip` : `openbucket-backup-${timestamp()}.zip`);

  const token = await acquireToken(cfg);
  await download(cfg, path, token, out, Boolean(flags.force));

  if (cfg.json) {
    printJson({ output: out, bucket: bucket ?? null });
    return EXIT.SUCCESS;
  }
  printLine(cfg.quiet ? out : `wrote backup to ${out}`);
  return EXIT.SUCCESS;
}

async function restore(
  cfg: CliConfig,
  flags: { bucket?: string; file?: string; yes?: boolean },
): Promise<number> {
  // The --yes gate + arg checks run BEFORE any token acquisition, so a gated
  // restore issues NO request at all (not even a login).
  if (!flags.file) throw usageError('usage: backup restore -f <file.zip> [--bucket <b>] --yes');
  // --yes gate: restore RESETS the instance/bucket. Without it, issue NO request.
  if (!flags.yes) {
    throw usageError(
      'backup restore RESETS the target and requires explicit confirmation; re-run with --yes',
    );
  }

  const { bucket } = flags;
  const path = bucket
    ? `/api/admin/buckets/${encodeURIComponent(bucket)}/restore`
    : '/api/admin/restore';

  const token = await acquireToken(cfg);
  const result = await upload<RestoreResult>(cfg, path, token, flags.file);

  if (cfg.json) {
    printJson(result);
    return EXIT.SUCCESS;
  }
  const parts = [
    result.bucketsRestored !== undefined ? `${result.bucketsRestored} bucket(s)` : null,
    `${result.objectsRestored} object(s)`,
  ].filter(Boolean);
  printLine(`restored ${parts.join(', ')}`);
  return EXIT.SUCCESS;
}

/** Dispatch a `backup` subcommand. `rest` is the positional tail after `backup`. */
export async function runBackup(
  cfg: CliConfig,
  rest: string[],
  flags: { bucket?: string; output?: string; file?: string; force?: boolean; yes?: boolean },
): Promise<number> {
  const sub = rest[0];
  if (!sub) throw usageError('usage: backup <create|restore> [args]');

  // The token is acquired inside each handler, AFTER its local gates (e.g. --yes).
  switch (sub) {
    case 'create':
      return create(cfg, flags);
    case 'restore':
      return restore(cfg, flags);
    default:
      throw usageError(`unknown backup subcommand "${sub}" (expected create|restore)`);
  }
}
