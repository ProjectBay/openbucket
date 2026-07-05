/**
 * Shared presentation layer for the CLI (TASK-3614): aligned human tables, a
 * `--json` mode, a `--quiet` mode, and helpers that keep the stdout/stderr split
 * clean — DATA to stdout (pipeable), NOTICES to stderr.
 */

/** A rendered column: a header plus a projection from a row to a cell string. */
export interface Column<T> {
  header: string;
  get: (row: T) => string;
}

/** Write one line of DATA to stdout. */
export function printLine(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/**
 * A NOTICE / guidance line → stderr, so stdout stays a clean data stream. The
 * caller suppresses these under `--quiet`.
 */
export function printNotice(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Emit `value` as a single pretty-printed JSON document to stdout and nothing
 * else — so `--json` output stays valid and pipeable (e.g. through `jq`).
 */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Render an aligned key/value block to stdout (used for single-object output). */
export function printKeyValue(pairs: Array<[string, string]>): void {
  const width = pairs.reduce((w, [k]) => Math.max(w, k.length), 0);
  for (const [k, v] of pairs) {
    printLine(`${k.padEnd(width)}  ${v}`);
  }
}

/**
 * Render `rows` as a fixed-width table to stdout. Column widths are computed from
 * the header + all cells. No color dependency (ANSI only when a TTY, and even
 * then we keep it plain to stay pipe-safe).
 */
export function printTable<T>(rows: readonly T[], columns: ReadonlyArray<Column<T>>): void {
  const cells = rows.map((row) => columns.map((c) => c.get(row) ?? ''));
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...cells.map((r) => r[i].length), 0),
  );

  const pad = (s: string, i: number): string =>
    i === columns.length - 1 ? s : s.padEnd(widths[i]);

  printLine(columns.map((c, i) => pad(c.header, i)).join('  '));
  printLine(widths.map((w, i) => pad('-'.repeat(Math.min(w, widths[i])), i)).join('  '));
  for (const row of cells) {
    printLine(row.map((cell, i) => pad(cell, i)).join('  '));
  }
  if (rows.length === 0) {
    printLine('(none)');
  }
}
