/**
 * `replication` command group (TASK-3613): `status` (read-only). Always succeeds
 * even when replication is unconfigured — "disabled" is not an error exit. No
 * remote endpoint/credential is ever surfaced (the controller never returns one).
 */

// Type-only — the canonical wire DTO (the source the api-client is generated
// from). Erased at emit: no runtime, no Angular pulled into the CLI.
import type { ReplicationStatusDto } from '../../lib/admin/replication/dto/replication-status.dto';

import type { CliConfig } from '../config';
import { EXIT, usageError } from '../errors';
import { request } from '../http-client';
import { printJson, printKeyValue, printLine, printTable } from '../output';
import { acquireToken } from '../session';

async function status(cfg: CliConfig): Promise<number> {
  const token = await acquireToken(cfg);
  const res = await request<ReplicationStatusDto>(cfg, 'GET', '/api/admin/replication/status', { token });

  if (cfg.json) {
    printJson(res);
    return EXIT.SUCCESS;
  }
  if (cfg.quiet) {
    printLine(res.enabled ? 'enabled' : 'disabled');
    return EXIT.SUCCESS;
  }

  printKeyValue([
    ['enabled', res.enabled ? 'yes' : 'no'],
    ['pending', String(res.pendingCount)],
    ['inflight', String(res.inflightCount)],
    ['failed', String(res.failedCount)],
    ['oldestPendingAgeMs', res.oldestPendingAgeMs == null ? '-' : String(res.oldestPendingAgeMs)],
    ['lastError', res.lastError ? res.lastError.message : '-'],
  ]);

  if (res.perBucket.length > 0) {
    printLine();
    printTable(res.perBucket, [
      { header: 'BUCKET', get: (b) => b.bucket },
      { header: 'PENDING', get: (b) => String(b.pendingCount) },
      { header: 'INFLIGHT', get: (b) => String(b.inflightCount) },
      { header: 'FAILED', get: (b) => String(b.failedCount) },
    ]);
  }
  return EXIT.SUCCESS;
}

/** Dispatch a `replication` subcommand. `rest` is the positional tail. */
export async function runReplication(cfg: CliConfig, rest: string[]): Promise<number> {
  const sub = rest[0];
  if (!sub) throw usageError('usage: replication status');

  switch (sub) {
    case 'status':
      return status(cfg);
    default:
      throw usageError(`unknown replication subcommand "${sub}" (expected status)`);
  }
}
