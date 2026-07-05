/**
 * `buckets` command group (TASK-3612): `ls | mb | rb`. Each maps to one admin
 * bucket operation and reuses the api-client DTO types (type-only) for shapes.
 */

// Type-only — the canonical wire DTOs (the source the api-client is generated
// from). Erased at emit: no runtime, no Angular pulled into the CLI.
import type { BucketSummaryDto } from '../../lib/admin/buckets/dto/bucket-summary.dto';
import type { CreateBucketDto } from '../../lib/admin/buckets/dto/create-bucket.dto';
import type { ListBucketsResponseDto } from '../../lib/admin/buckets/dto/list-buckets-response.dto';

import type { CliConfig } from '../config';
import { EXIT, usageError } from '../errors';
import { request } from '../http-client';
import { printJson, printLine, printTable } from '../output';
import { acquireToken } from '../session';

/** Mirror of `CreateBucketSchema`'s `BUCKET_NAME` for a fast client-side check. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

async function ls(cfg: CliConfig): Promise<number> {
  const token = await acquireToken(cfg);
  const res = await request<ListBucketsResponseDto>(cfg, 'GET', '/api/admin/buckets', { token });

  if (cfg.json) {
    printJson(res);
    return EXIT.SUCCESS;
  }
  if (cfg.quiet) {
    for (const b of res.buckets) printLine(b.name);
    return EXIT.SUCCESS;
  }

  printTable(res.buckets, [
    { header: 'NAME', get: (b) => b.name },
    { header: 'VERSIONING', get: (b) => String(b.versioning) },
    { header: 'OBJECT-LOCK', get: (b) => (b.objectLock ? 'yes' : 'no') },
    { header: 'OBJECTS', get: (b) => String(b.objectCount) },
    { header: 'SIZE', get: (b) => String(b.sizeBytes) },
    { header: 'CREATED', get: (b) => b.createdAt },
  ]);
  return EXIT.SUCCESS;
}

async function mb(cfg: CliConfig, name: string | undefined, flags: {
  versioning?: string;
  objectLock?: boolean;
  region?: string;
}): Promise<number> {
  // Validate locally BEFORE acquiring a token, so a bad name issues no request
  // (not even a login round-trip).
  if (!name) throw usageError('usage: buckets mb <name> [--versioning enabled|disabled] [--object-lock] [--region <r>]');
  if (!BUCKET_NAME.test(name)) {
    throw usageError(
      `invalid bucket name "${name}": must match S3 naming rules ${BUCKET_NAME.source} (issues no request)`,
    );
  }
  const versioning = flags.versioning ?? 'disabled';
  if (versioning !== 'enabled' && versioning !== 'disabled') {
    throw usageError('--versioning must be "enabled" or "disabled"');
  }

  const body: CreateBucketDto = {
    name,
    versioning,
    objectLock: Boolean(flags.objectLock),
    region: flags.region ?? 'us-east-1',
  };
  const token = await acquireToken(cfg);
  const created = await request<BucketSummaryDto>(cfg, 'POST', '/api/admin/buckets', { token, body });

  if (cfg.json) {
    printJson(created);
    return EXIT.SUCCESS;
  }
  printLine(cfg.quiet ? created.name : `created bucket ${created.name}`);
  return EXIT.SUCCESS;
}

async function rb(cfg: CliConfig, name: string | undefined): Promise<number> {
  if (!name) throw usageError('usage: buckets rb <name>');
  const token = await acquireToken(cfg);
  // The server returns 409 (BucketNotEmpty) for a non-empty bucket; that message
  // is surfaced verbatim by the transport's error mapping.
  await request<void>(cfg, 'DELETE', `/api/admin/buckets/${encodeURIComponent(name)}`, { token });

  if (cfg.json) {
    printJson({ deleted: name });
    return EXIT.SUCCESS;
  }
  printLine(cfg.quiet ? name : `deleted bucket ${name}`);
  return EXIT.SUCCESS;
}

/** Dispatch a `buckets` subcommand. `rest` is the positional tail after `buckets`. */
export async function runBuckets(cfg: CliConfig, rest: string[], flags: {
  versioning?: string;
  objectLock?: boolean;
  region?: string;
}): Promise<number> {
  const sub = rest[0];
  if (!sub) throw usageError('usage: buckets <ls|mb|rb> [args]');

  // Each handler acquires the token only AFTER its own local validation, so a
  // usage error never triggers a login.
  switch (sub) {
    case 'ls':
      return ls(cfg);
    case 'mb':
      return mb(cfg, rest[1], flags);
    case 'rb':
      return rb(cfg, rest[1]);
    default:
      throw usageError(`unknown buckets subcommand "${sub}" (expected ls|mb|rb)`);
  }
}
