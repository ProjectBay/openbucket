#!/usr/bin/env node
/**
 * `openbucket` — the admin CLI for `@openbucket/nestjs` (STORY-1201).
 *
 * A dependency-free command-line client over the admin JSON API: bucket & key
 * management, backup/restore, and replication status. Credentials never touch
 * `argv` (the password comes only from `$OPENBUCKET_PASSWORD` or a non-echoing
 * prompt); tokens live in memory for the process lifetime only; every error path
 * is redacted before it reaches stderr.
 *
 * `runCli` returns a numeric exit code; only this module calls `process.exit`, so
 * the CLI stays unit-testable.
 */

import { OPENBUCKET_VERSION } from '../lib/version';
import { parseCli, type ParsedFlags } from './args';
import { runBackup } from './commands/backup';
import { runBuckets } from './commands/buckets';
import { runKeys } from './commands/keys';
import { runReplication } from './commands/replication';
import { resolveConfig } from './config';
import { CliError, EXIT, redact, type ExitCode } from './errors';
import { printLine, printNotice } from './output';

const USAGE = `openbucket — admin CLI for @openbucket/nestjs

Usage:
  openbucket <command> <subcommand> [options]

Commands:
  buckets ls                              list buckets
  buckets mb <name> [--versioning enabled|disabled] [--object-lock] [--region <r>]
  buckets rb <name>                       remove an (empty) bucket
  keys list                               list access keys
  keys create --label <l> [--scope prefix:<bucket>/<prefix>]
  keys revoke <id>                        disable an access key
  backup create [--bucket <b>] [-o <file.zip>] [--force]
  backup restore -f <file.zip> [--bucket <b>] --yes
  replication status                      show replication status

Global options:
  --endpoint <url>   admin endpoint (env OPENBUCKET_ENDPOINT; default http://127.0.0.1:3900)
  --username <u>     admin username (env OPENBUCKET_USERNAME)
  --json             machine-readable JSON output
  --quiet            suppress notices; emit only the essential datum
  --insecure         allow credentials over non-loopback plaintext http
  -h, --help         show this help
  --version          print the version

Credentials:
  Password is read from $OPENBUCKET_PASSWORD or an interactive prompt — never a flag.
  Set $OPENBUCKET_TOKEN to reuse an existing bearer token and skip login.`;

/** Map an unknown thrown value to a redacted {@link CliError}. */
function toCliError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CliError(redact(message), EXIT.ERROR);
}

/**
 * Run the CLI and resolve to a numeric exit code. Never calls `process.exit`
 * (the entrypoint below does), so it is fully testable.
 */
export async function runCli(argv: string[]): Promise<number> {
  let flags: ParsedFlags;
  let positionals: string[];
  try {
    ({ flags, positionals } = parseCli(argv));
  } catch (err) {
    const e = toCliError(err);
    printNotice(e.toStderr());
    return e.exitCode;
  }

  const command = positionals[0];

  // --version / --help short-circuit to stdout, exit 0.
  if (flags.version) {
    printLine(OPENBUCKET_VERSION);
    return EXIT.SUCCESS;
  }
  if (flags.help || !command) {
    printLine(USAGE);
    return EXIT.SUCCESS;
  }

  try {
    const cfg = resolveConfig(flags, process.env);
    const rest = positionals.slice(1);

    switch (command) {
      case 'buckets':
        return await runBuckets(cfg, rest, {
          versioning: flags.versioning,
          objectLock: flags['object-lock'],
          region: flags.region,
        });
      case 'keys':
        return await runKeys(cfg, rest, { label: flags.label, scope: flags.scope });
      case 'backup':
        return await runBackup(cfg, rest, {
          bucket: flags.bucket,
          output: flags.output,
          file: flags.file,
          force: flags.force,
          yes: flags.yes,
        });
      case 'replication':
        return await runReplication(cfg, rest);
      default: {
        printNotice(`unknown command "${command}"`);
        printNotice(USAGE);
        return EXIT.USAGE;
      }
    }
  } catch (err) {
    const e = toCliError(err);
    printNotice(e.toStderr());
    // Optional redacted stack trace for debugging — still run through redact().
    if (process.env.OPENBUCKET_DEBUG === '1' && err instanceof Error && err.stack) {
      printNotice(redact(err.stack));
    }
    return e.exitCode;
  }
}

// Entrypoint: the ONLY place `process.exit` is called. Guarded so importing the
// module for tests does not run the CLI.
if (require.main === module) {
  runCli(process.argv.slice(2))
    .then((code: ExitCode | number) => process.exit(code))
    .catch((err: unknown) => {
      // Last-resort guard — a redacted one-liner, never a raw Node stack dump.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${redact(message)}\n`);
      process.exit(EXIT.ERROR);
    });
}
