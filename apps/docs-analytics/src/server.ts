// Tiny cookieless, first-party pageview collector for the OpenBucket docs site.
//
//   POST /collect     ← the Docusaurus beacon (text/plain JSON body)
//   GET  /stats       → HTML dashboard   (bearer token)
//   GET  /stats.json  → JSON             (bearer token)
//   GET  /health      → "ok"
//
// Privacy: the client IP and User-Agent are combined with a per-day rotating
// salt and hashed (SHA-256) to a visitor id used only for de-duplication; the
// raw IP is never stored. No cookies, no cross-day correlation, no PII.

import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { loadConfig } from './config.js';
import { Store, dayString } from './db.js';
import { renderDashboard } from './stats-page.js';

const cfg = loadConfig();
const store = new Store(cfg.dbPath);

// Prune on boot, then daily. unref() so the timer never keeps the process alive.
store.prune(cfg.retentionDays);
setInterval(() => store.prune(cfg.retentionDays), 86_400_000).unref();

const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime/i;

function clientIp(req: http.IncomingMessage): string {
  if (cfg.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (first) return first.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? '';
}

function sanitizePath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) return '/';
  let s = p.split('?')[0]!.split('#')[0]!;
  if (!s.startsWith('/')) s = '/' + s;
  return s.slice(0, 512);
}

function referrerHost(r: unknown): string {
  if (typeof r !== 'string' || r === '') return 'direct';
  try {
    return new URL(r).host.slice(0, 255) || 'direct';
  } catch {
    return 'other';
  }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function tokenOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function handleCollect(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (cfg.allowedOrigin !== '*' && origin && origin !== cfg.allowedOrigin) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', cfg.allowedOrigin === '*' ? (origin ?? '*') : cfg.allowedOrigin);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > cfg.maxBodyBytes) {
      aborted = true;
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('error', () => {});
  req.on('end', () => {
    if (aborted) return;
    // Acknowledge immediately; a beacon must never see an error or block the page.
    res.writeHead(204).end();
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const ua = String(req.headers['user-agent'] ?? '').slice(0, 512);
      if (BOT_RE.test(ua)) return; // drop obvious bots / synthetic checks
      const ts = Date.now();
      const day = dayString(ts);
      const salt = store.dailySalt(day);
      const visitor = createHash('sha256')
        .update(`${clientIp(req)}|${ua}|${salt}`)
        .digest('hex');
      store.record({
        ts,
        day,
        path: sanitizePath(body.path),
        referrer: referrerHost(body.referrer),
        visitor,
        screenW: clampInt(body.screenW, 0, 20000),
        tz: typeof body.tz === 'string' ? body.tz.slice(0, 64) : '',
      });
    } catch {
      // ignore malformed beacons
    }
  });
}

function handleStats(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  asJson: boolean,
): void {
  if (!cfg.statsToken) {
    res.writeHead(503, { 'content-type': 'text/plain' }).end('STATS_TOKEN is not configured\n');
    return;
  }
  const auth = String(req.headers.authorization ?? '');
  const provided = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : (url.searchParams.get('token') ?? '');
  if (!tokenOk(provided, cfg.statsToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.writeHead(401, { 'content-type': 'text/plain' }).end('unauthorized\n');
    return;
  }
  const days = clampInt(url.searchParams.get('days') ?? 30, 1, 3650) || 30;
  const stats = store.stats(days);
  if (asJson) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(
      JSON.stringify(stats, null, 2),
    );
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
      renderDashboard(stats, days),
    );
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  switch (url.pathname) {
    case '/collect':
      return handleCollect(req, res);
    case '/stats':
      if (req.method !== 'GET') return void res.writeHead(405).end();
      return handleStats(req, res, url, false);
    case '/stats.json':
      if (req.method !== 'GET') return void res.writeHead(405).end();
      return handleStats(req, res, url, true);
    case '/health':
      return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n');
    default:
      return void res.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

server.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `docs-analytics collector listening on :${cfg.port} ` +
      `(db=${cfg.dbPath}, origin=${cfg.allowedOrigin}, stats=${cfg.statsToken ? 'on' : 'disabled'})`,
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
