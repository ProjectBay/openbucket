/**
 * Stateful side of the conformance report (see {@link ./report} for the pure
 * shape). The suite runs across a worker process while Jest's `globalTeardown`
 * runs in the main process, so results are streamed to a JSONL scratch file
 * that both sides can reach; the teardown reads it back, folds it via
 * {@link ./report#buildReport}, and writes the JSON + Markdown artifacts.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ClientId, ConformanceResult, ConformanceStatus } from './report';

/** Directory the report artifacts (and scratch JSONL) live in. */
export const REPORT_DIR = resolve(__dirname, '..', '..', 'report');

/** Final artifact paths. */
export const REPORT_JSON_PATH = join(REPORT_DIR, 'conformance-report.json');
export const REPORT_MD_PATH = join(REPORT_DIR, 'conformance-report.md');

/**
 * Append-only scratch file the workers stream results into. Overridable via
 * `CONFORMANCE_RESULTS_FILE` (used by tests to isolate the sink).
 */
export function resultsFile(): string {
  return process.env.CONFORMANCE_RESULTS_FILE ?? join(REPORT_DIR, 'results.jsonl');
}

/** Record one (client × operation) outcome by appending a JSONL line. */
export function record(result: ConformanceResult): void {
  const file = resultsFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(result)}\n`);
}

/**
 * Run one probe under a canonical S3 operation name, recording pass on success
 * and fail (with the error message) on throw — then re-throw so the underlying
 * Jest assertion still fails the test. This keeps the existing assertions the
 * source of truth; the report is *derived* from the same run, never a
 * replacement.
 */
export async function step<T>(
  client: ClientId,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const value = await fn();
    record({ client, operation, status: 'pass', durationMs: Date.now() - start });
    return value;
  } catch (err) {
    record({
      client,
      operation,
      status: 'fail',
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Parse the JSONL scratch file back into results (empty if it does not exist). */
export function readResults(file = resultsFile()): ConformanceResult[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const results: ConformanceResult[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as ConformanceResult;
    if (isResult(parsed)) results.push(parsed);
  }
  return results;
}

const STATUSES: readonly ConformanceStatus[] = ['pass', 'fail', 'skip'];

function isResult(value: unknown): value is ConformanceResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.client === 'string' &&
    typeof r.operation === 'string' &&
    typeof r.status === 'string' &&
    STATUSES.includes(r.status as ConformanceStatus)
  );
}
