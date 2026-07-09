/**
 * Best-effort provenance collection for a conformance run: the image under
 * test, a generation timestamp, and each client's self-reported version. All
 * version probes are best-effort — a missing binary yields `'unknown'` rather
 * than failing the report.
 */
import { execFileSync } from 'node:child_process';

import { CLIENT_LABELS, type ConformanceMetadata } from './report';

/** Extract the first version-looking token from a `--version` blob. */
function firstVersion(output: string): string {
  const match = output.match(/\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?/);
  return match ? match[0] : output.trim().split('\n')[0]?.trim() || 'unknown';
}

function probe(bin: string, args: string[]): string {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return firstVersion(out);
  } catch {
    return 'unknown';
  }
}

function sdkVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('@aws-sdk/client-s3/package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Gather run metadata, shelling out to each CLI for its version (best-effort). */
export function collectMetadata(now: Date = new Date()): ConformanceMetadata {
  return {
    image: process.env.OPENBUCKET_IMAGE ?? 'openbucket:local',
    generatedAt: now.toISOString(),
    suite: 'openbucket-conformance',
    clientVersions: {
      [CLIENT_LABELS['aws-sdk-js']]: sdkVersion(),
      [CLIENT_LABELS['aws-cli']]: probe('aws', ['--version']),
      [CLIENT_LABELS.mc]: probe('mc', ['--version']),
      [CLIENT_LABELS.s3cmd]: probe('s3cmd', ['--version']),
    },
  };
}
