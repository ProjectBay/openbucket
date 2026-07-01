// OpenBucket fault-injection harness (shared).
//
// Single-node store: NestJS + MikroORM/better-sqlite3 (metadata) + local
// filesystem (blob payloads). This harness spawns the *built* backend
// (dist/apps/openbucket-backend/main.js) against a disposable DATA_DIR, drives
// it over the real S3 wire protocol (@aws-sdk/client-s3, SigV4 with the root
// credentials), and provides fault primitives:
//   - process SIGKILL at chosen moments,
//   - env-gated failpoints (OB_FAULT=<point>) if the source is instrumented,
//   - on-disk corruption / truncation of stored blobs,
//   - read-only inspection of the metadata SQLite DB after a crash.
//
// Everything runs in a scratch dir; it never touches real data.
//
// Run an attack:  node tests/fault/<attack>.mjs
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  openSync,
  readSync,
  writeSync,
  closeSync,
  truncateSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

// Core `http` (not global fetch/undici): this env routes undici through a
// corporate proxy that can't reach 127.0.0.1. Node core http ignores HTTP_PROXY.
function httpStatus(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(0); });
  });
}

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..');
export const MAIN_JS = join(REPO, 'dist', 'apps', 'openbucket-backend', 'main.js');
const SCRATCH = process.env.OB_FAULT_SCRATCH ||
  'c:/temp/claude/C--DevB-LocalProjects-org-openbucket/0dcd6288-c3ab-4ea7-b103-26c5e69d63dc/scratchpad/fault';

export const ROOT_ACCESS_KEY_ID = 'AKIA1234567890ABCD';
export const ROOT_SECRET_ACCESS_KEY = 'x'.repeat(40);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rnd = () => Math.random().toString(36).slice(2, 10);

export function scratchDir(tag = 'run') {
  mkdirSync(SCRATCH, { recursive: true });
  return mkdtempSync(join(SCRATCH, `${tag}-`));
}

/**
 * Spawn the built backend against a (possibly pre-existing) DATA_DIR and wait
 * until it serves /api/admin/health. Returns a handle with kill helpers.
 *
 * opts: { port?, dataDir?, fault?(=OB_FAULT), env?, waitMs? }
 */
export async function spawnApp(opts = {}) {
  if (!existsSync(MAIN_JS)) {
    throw new Error(`Built backend missing: ${MAIN_JS}\nRun: npx nx build openbucket-backend`);
  }
  const port = opts.port ?? 9300 + Math.floor(Math.random() * 500);
  const dataDir = opts.dataDir ?? scratchDir('data');
  mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    DATA_DIR: dataDir,
    JWT_SECRET: 'a'.repeat(40),
    ROOT_ACCESS_KEY_ID,
    ROOT_SECRET_ACCESS_KEY,
    ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    ...(opts.fault ? { OB_FAULT: opts.fault } : {}),
    ...(opts.env ?? {}),
  };
  const proc = spawn(process.execPath, [MAIN_JS], { env, stdio: 'pipe' });
  let buf = '';
  proc.stdout.on('data', (d) => (buf += d));
  proc.stderr.on('data', (d) => (buf += d));
  let exited;
  proc.on('exit', (code, signal) => (exited = { code, signal }));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (opts.waitMs ?? 35000);
  while (Date.now() < deadline) {
    if (exited) throw new Error(`app exited before ready (code=${exited.code} sig=${exited.signal}):\n${buf}`);
    {
      const code = await httpStatus(`${baseUrl}/api/admin/health`);
      if (code === 200) {
        return {
          proc, port, dataDir, baseUrl,
          log: () => buf,
          exited: () => exited,
          kill: (sig = 'SIGKILL') => proc.kill(sig),
          waitExit: () =>
            new Promise((res) => (exited ? res(exited) : proc.on('exit', (code, signal) => res({ code, signal })))),
        };
      }
    }
    await sleep(200);
  }
  proc.kill('SIGKILL');
  throw new Error(`app did not become ready in time:\n${buf}`);
}

/** S3 client aimed at the spawned app (path-style, root SigV4 creds). */
export function s3(port) {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    endpoint: `http://127.0.0.1:${port}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: ROOT_ACCESS_KEY_ID, secretAccessKey: ROOT_SECRET_ACCESS_KEY },
    // Keep retries off so a fault surfaces as one deterministic error, not a retry storm.
    maxAttempts: 1,
  });
}

export const s3cmds = () => require('@aws-sdk/client-s3');

// ---- disk-level fault primitives -------------------------------------------

/** Recursively list every regular file under a directory. */
export function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkFiles(p));
    else out.push({ path: p, size: st.size });
  }
  return out;
}

/** Blob payload files under DATA_DIR/blobs (the object bytes on disk). */
export function blobFiles(dataDir) {
  return walkFiles(join(dataDir, 'blobs'));
}

/** Flip one byte at `offset` in a file (bit-rot simulation). */
export function flipByte(path, offset = 0) {
  const fd = openSync(path, 'r+');
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, offset);
    b[0] ^= 0xff;
    writeSync(fd, b, 0, 1, offset);
  } finally {
    closeSync(fd);
  }
}

/** Overwrite a byte range with a fixed value. */
export function overwrite(path, offset, bytes) {
  const fd = openSync(path, 'r+');
  try {
    writeSync(fd, Buffer.from(bytes), 0, bytes.length, offset);
  } finally {
    closeSync(fd);
  }
}

export function truncateTo(path, size) {
  truncateSync(path, size);
}

// ---- metadata DB inspection (read-only) ------------------------------------

export function openDb(dataDir) {
  const Database = require('better-sqlite3');
  return new Database(join(dataDir, 'openbucket.db'), { readonly: true, fileMustExist: true });
}

/** Convenience: list committed object rows (bucket, key, size, etag). Tolerant
 *  of column-name differences — pass the real table/columns if this guesses wrong. */
export function objectRows(dataDir) {
  const db = openDb(dataDir);
  try {
    const cols = db.prepare(`PRAGMA table_info(objects)`).all().map((c) => c.name);
    return { columns: cols, rows: db.prepare(`SELECT * FROM objects`).all() };
  } finally {
    db.close();
  }
}

export function tableNames(dataDir) {
  const db = openDb(dataDir);
  try {
    return db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  } finally {
    db.close();
  }
}

// ---- tiny assertion helpers for standalone scripts -------------------------

let PASS = 0, FAIL = 0;
export function check(label, cond, detail = '') {
  if (cond) { PASS++; console.log(`  ✓ ${label}`); }
  else { FAIL++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}
export function finding(label, detail) {
  console.log(`  ⚠ FINDING: ${label}${detail ? ' — ' + detail : ''}`);
}
export function summary(name) {
  console.log(`\n[${name}] ${PASS} checks passed, ${FAIL} failed`);
  return FAIL;
}
export async function readBody(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}
