// SQLite storage. Raw pageview events + a per-day rotating salt used to derive
// cookieless visitor hashes. No raw IPs or personal data are ever stored.

import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

export interface EventInput {
  ts: number;
  day: string;
  path: string;
  referrer: string;
  visitor: string;
  screenW: number;
  tz: string;
}

export interface Bucket {
  key: string;
  views: number;
  uniques: number;
}

export interface Stats {
  days: number;
  since: string;
  totalViews: number;
  totalUniques: number;
  topPaths: Bucket[];
  topReferrers: Bucket[];
  perDay: Bucket[];
}

export class Store {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id       INTEGER PRIMARY KEY,
        ts       INTEGER NOT NULL,
        day      TEXT    NOT NULL,
        path     TEXT    NOT NULL,
        referrer TEXT    NOT NULL,
        visitor  TEXT    NOT NULL,
        screen_w INTEGER NOT NULL DEFAULT 0,
        tz       TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_events_day  ON events(day);
      CREATE INDEX IF NOT EXISTS idx_events_path ON events(day, path);

      CREATE TABLE IF NOT EXISTS daily_salt (
        day   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * The salt for a UTC day, created on first use and reused for the rest of the
   * day. Rotating it daily means a visitor hash can't be correlated across days.
   */
  dailySalt(day: string): string {
    const row = this.db
      .prepare('SELECT value FROM daily_salt WHERE day = ?')
      .get(day) as { value: string } | undefined;
    if (row) return row.value;
    const value = randomBytes(32).toString('hex');
    // INSERT OR IGNORE guards the (rare) concurrent-first-write race.
    this.db
      .prepare('INSERT OR IGNORE INTO daily_salt (day, value) VALUES (?, ?)')
      .run(day, value);
    const stored = this.db
      .prepare('SELECT value FROM daily_salt WHERE day = ?')
      .get(day) as { value: string };
    return stored.value;
  }

  record(e: EventInput): void {
    this.db
      .prepare(
        `INSERT INTO events (ts, day, path, referrer, visitor, screen_w, tz)
         VALUES (@ts, @day, @path, @referrer, @visitor, @screenW, @tz)`,
      )
      .run(e);
  }

  /** Delete raw events (and stale salts) older than the retention window. */
  prune(retentionDays: number): number {
    const cutoff = dayString(Date.now() - retentionDays * 86_400_000);
    const info = this.db.prepare('DELETE FROM events WHERE day < ?').run(cutoff);
    this.db.prepare('DELETE FROM daily_salt WHERE day < ?').run(cutoff);
    return info.changes;
  }

  stats(days: number): Stats {
    const since = dayString(Date.now() - (days - 1) * 86_400_000);
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS uniques
         FROM events WHERE day >= ?`,
      )
      .get(since) as { views: number; uniques: number };

    const group = (col: string, limit: number): Bucket[] =>
      this.db
        .prepare(
          `SELECT ${col} AS key, COUNT(*) AS views, COUNT(DISTINCT visitor) AS uniques
           FROM events WHERE day >= ?
           GROUP BY ${col} ORDER BY views DESC, key ASC LIMIT ?`,
        )
        .all(since, limit) as Bucket[];

    const perDay = this.db
      .prepare(
        `SELECT day AS key, COUNT(*) AS views, COUNT(DISTINCT visitor) AS uniques
         FROM events WHERE day >= ?
         GROUP BY day ORDER BY day ASC`,
      )
      .all(since) as Bucket[];

    return {
      days,
      since,
      totalViews: totals.views,
      totalUniques: totals.uniques,
      topPaths: group('path', 25),
      topReferrers: group('referrer', 25),
      perDay,
    };
  }

  close(): void {
    this.db.close();
  }
}

/** UTC day (YYYY-MM-DD) for an epoch-ms timestamp. */
export function dayString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
