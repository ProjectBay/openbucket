/**
 * Thin `fetch`-based HTTP transport for the CLI (TASK-3611 + TASK-3613).
 *
 * Uses the global `fetch`/`Headers`/`Response` (Node ≥ 20.19) — no
 * `node-fetch`/`axios`, keeping runtime deps at zero. Attaches the bearer token,
 * maps non-2xx to a typed {@link CliError} via {@link fromResponse}, and streams
 * binary `.zip` bodies to/from disk so archives are never buffered in memory.
 * The bearer token is NEVER included in a thrown message.
 */

import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import type { CliConfig } from './config';
import { CliError, fromResponse, redact } from './errors';

export interface RequestOptions {
  /** JSON request body — serialized and sent with `Content-Type: application/json`. */
  body?: unknown;
  /** Bearer token; attached as `Authorization: Bearer <token>` when present. */
  token?: string;
}

function authHeaders(token?: string): Headers {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function networkError(cfg: CliConfig, err: unknown): CliError {
  const detail = err instanceof Error ? err.message : String(err);
  return new CliError(`could not reach ${cfg.endpoint}: ${redact(detail)}`);
}

/**
 * Perform a JSON request. On 2xx parses and returns the JSON body (`undefined`
 * for 204/empty). On non-2xx throws a redacting {@link CliError}.
 */
export async function request<T>(
  cfg: CliConfig,
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers = authHeaders(opts.token);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.endpoint}${path}`, { method, headers, body });
  } catch (err) {
    throw networkError(cfg, err);
  }

  if (!res.ok) throw await fromResponse(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}

/**
 * Stream a binary GET response to `outPath`. Refuses to overwrite an existing
 * file unless `force`. On a non-2xx response no file is created; on a mid-stream
 * failure the partially-written file is deleted so a truncated `.zip` is never
 * left behind.
 */
export async function download(
  cfg: CliConfig,
  path: string,
  token: string,
  outPath: string,
  force: boolean,
): Promise<void> {
  if (!force && existsSync(outPath)) {
    throw new CliError(`refusing to overwrite existing file ${outPath} (use --force)`);
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.endpoint}${path}`, { method: 'GET', headers: authHeaders(token) });
  } catch (err) {
    throw networkError(cfg, err);
  }

  // Non-2xx (or an empty body) surfaces before any file is created on disk.
  if (!res.ok || !res.body) throw await fromResponse(res);

  const source = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  try {
    await pipeline(source, createWriteStream(outPath));
  } catch (err) {
    // Mid-stream failure: remove the truncated output so nothing partial survives.
    await rm(outPath, { force: true }).catch(() => undefined);
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(`download to ${outPath} failed: ${redact(detail)}`);
  }
}

/**
 * Stream a file as a raw `application/zip` request body (the restore endpoints
 * read the raw request stream — the global body parser is off). Sets
 * `Content-Length` when the file size is known. Returns the parsed JSON result.
 */
export async function upload<T>(
  cfg: CliConfig,
  path: string,
  token: string,
  filePath: string,
): Promise<T> {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    throw new CliError(`cannot read file ${filePath}`);
  }

  const headers = authHeaders(token);
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Length', String(size));

  const source = Readable.toWeb(createReadStream(filePath)) as unknown as WebReadableStream<Uint8Array>;

  let res: Response;
  try {
    // `duplex: 'half'` is required by undici when sending a stream body; it is
    // not yet in the DOM `RequestInit` type, hence the cast.
    res = await fetch(`${cfg.endpoint}${path}`, {
      method: 'POST',
      headers,
      body: source,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  } catch (err) {
    throw networkError(cfg, err);
  }

  if (!res.ok) throw await fromResponse(res);
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : (undefined as T));
}
