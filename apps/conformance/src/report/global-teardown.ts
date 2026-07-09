/**
 * Jest `globalTeardown`: runs once in the main process after every conformance
 * spec has finished. It reads the streamed results (see {@link ./recorder}),
 * folds them into a report, and writes the two artifacts consumed by CI and the
 * docs: `conformance-report.json` and `conformance-report.md`.
 *
 * This never throws — a reporting hiccup must not fail an otherwise-green run
 * (the specs' own assertions remain the pass/fail source of truth).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { collectMetadata } from './metadata';
import { buildReport, renderMarkdown } from './report';
import {
  readResults,
  REPORT_DIR,
  REPORT_JSON_PATH,
  REPORT_MD_PATH,
  resultsFile,
} from './recorder';

export default async function globalTeardown(): Promise<void> {
  try {
    const results = readResults();
    const report = buildReport(results, collectMetadata());

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(REPORT_MD_PATH, renderMarkdown(report));

    // Drop the scratch JSONL so the next run starts clean.
    rmSync(resultsFile(), { force: true });

    // eslint-disable-next-line no-console
    console.log(
      `\n[conformance] wrote report: ${report.summary.pass}/${report.summary.total} passed → ${REPORT_JSON_PATH}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[conformance] failed to write report:', err);
  }
}
