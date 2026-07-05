/**
 * Minimal flag parser + command router (TASK-3610). Zero external deps — built
 * on `node:util.parseArgs` (stable since Node 18) rather than commander/yargs,
 * keeping the CLI dependency-free.
 */

import { parseArgs } from 'node:util';

import { usageError } from './errors';

/** The full option schema across all commands (parsed in one pass, then routed). */
const OPTIONS = {
  // Global
  endpoint: { type: 'string' },
  username: { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  insecure: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
  // buckets
  versioning: { type: 'string' },
  'object-lock': { type: 'boolean' },
  region: { type: 'string' },
  // keys
  label: { type: 'string' },
  scope: { type: 'string' },
  // backup / replication
  bucket: { type: 'string' },
  output: { type: 'string', short: 'o' },
  file: { type: 'string', short: 'f' },
  force: { type: 'boolean' },
  yes: { type: 'boolean' },
} as const;

export interface ParsedFlags {
  endpoint?: string;
  username?: string;
  json?: boolean;
  quiet?: boolean;
  insecure?: boolean;
  help?: boolean;
  version?: boolean;
  versioning?: string;
  'object-lock'?: boolean;
  region?: string;
  label?: string;
  scope?: string;
  bucket?: string;
  output?: string;
  file?: string;
  force?: boolean;
  yes?: boolean;
}

export interface ParsedArgs {
  flags: ParsedFlags;
  /** Positional args in order: `[command, subcommand, ...rest]`. */
  positionals: string[];
}

/**
 * Parse `argv` (already sliced past `node script`). Unknown options throw a
 * usage {@link CliError} (exit 2) rather than a raw parseArgs error.
 */
export function parseCli(argv: string[]): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    return { flags: values as ParsedFlags, positionals };
  } catch (err) {
    throw usageError(err instanceof Error ? err.message : 'invalid arguments');
  }
}
