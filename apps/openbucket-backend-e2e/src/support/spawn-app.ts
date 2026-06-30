import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

/**
 * Raw HTTP GET that CAN set a custom Host header — `fetch`/undici treats Host
 * as a forbidden header and ignores it, which breaks virtual-host-style tests.
 */
export function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Locate the built backend entrypoint relative to the workspace root. */
export function mainJsPath(): string {
  const candidates = [
    join(process.cwd(), 'dist/apps/openbucket-backend/main.js'),
    join(__dirname, '../../../../dist/apps/openbucket-backend/main.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Built backend not found. Run \`nx build openbucket-backend\` first. Looked in:\n${candidates.join('\n')}`,
    );
  }
  return found;
}

/** A format-valid environment that satisfies the refuse-to-boot schema. */
export function validEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  // A fresh, unique DATA_DIR per call (STORY-0505 mkdtempSync convention).
  // Previously this was keyed on `process.pid` — but that pid is the *jest
  // worker*, shared by every spec file the worker runs in sequence, so they all
  // pointed at the same dir and leaked state into each other (e.g. a bucket
  // listing seeing other specs' buckets). A per-spawn mkdtemp dir isolates them.
  const scratch = join(process.cwd(), 'tmp');
  mkdirSync(scratch, { recursive: true });
  return {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: mkdtempSync(join(scratch, 'ob-e2e-')),
    JWT_SECRET: 'a'.repeat(40),
    ROOT_ACCESS_KEY_ID: 'AKIA1234567890ABCD',
    ROOT_SECRET_ACCESS_KEY: 'x'.repeat(40),
    ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    ...overrides,
  };
}

export interface SpawnedApp {
  proc: ChildProcess;
  baseUrl: string;
  /**
   * The unique DATA_DIR this app was spawned with. Specs that inspect the
   * on-disk SQLite file (e.g. to assert a secret is hashed) must read it from
   * here — the dir is a per-spawn mkdtemp, not a path they can reconstruct.
   */
  dataDir: string;
  /** Combined stdout+stderr captured so far. */
  log(): string;
  /** Resolves with the process exit code (or null if killed by signal). */
  waitForExit(): Promise<number | null>;
  kill(signal: NodeJS.Signals): boolean;
}

/**
 * Spawn the built backend and resolve once it logs "OpenBucket listening".
 * Rejects if the process exits before becoming ready.
 */
export async function spawnApp(
  port: number,
  envOverrides: Record<string, string> = {},
  { waitForReady = true }: { waitForReady?: boolean } = {},
): Promise<SpawnedApp> {
  const env = validEnv({ PORT: String(port), ...envOverrides });
  const proc = spawn(process.execPath, [mainJsPath()], { env, stdio: 'pipe' });

  let buffer = '';
  proc.stdout?.on('data', (d) => (buffer += d.toString()));
  proc.stderr?.on('data', (d) => (buffer += d.toString()));

  let exited: { code: number | null } | undefined;
  proc.on('exit', (code) => (exited = { code }));

  // `close` fires only after the child's stdout/stderr pipes have been fully
  // drained into `buffer` — unlike `exit`, which can fire while the final writes
  // (e.g. the graceful-shutdown sequence) are still in flight in the OS pipe.
  // waitForExit() resolves on `close` so callers that read `log()` immediately
  // afterwards see the complete output.
  let closed: { code: number | null } | undefined;
  proc.on('close', (code) => (closed = { code }));

  const api: SpawnedApp = {
    proc,
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir: env.DATA_DIR as string,
    log: () => buffer,
    kill: (signal) => proc.kill(signal),
    waitForExit: () =>
      new Promise((resolve) => {
        if (closed) return resolve(closed.code);
        proc.on('close', (code) => resolve(code));
      }),
  };

  if (!waitForReady) return api;

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`boot timeout:\n${buffer}`)), 20_000);
    const check = setInterval(() => {
      if (buffer.includes('OpenBucket listening')) {
        clearInterval(check);
        clearTimeout(deadline);
        resolve();
      } else if (exited) {
        clearInterval(check);
        clearTimeout(deadline);
        reject(new Error(`exited before ready (code ${exited.code}):\n${buffer}`));
      }
    }, 50);
  });

  return api;
}
