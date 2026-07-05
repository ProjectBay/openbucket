/**
 * Non-echoing password prompt (TASK-3611). Runs only on a TTY; in CI (no TTY)
 * it throws an instructive {@link CliError} instead of hanging, telling the user
 * to set `$OPENBUCKET_PASSWORD` / `$OPENBUCKET_TOKEN`.
 */

import * as readline from 'node:readline';

import { CliError, EXIT } from './errors';

/**
 * Prompt for a password without echoing keystrokes. The prompt `label` is
 * written once; every subsequent output write (the echoed characters) is muted
 * by swapping `readline`'s `_writeToOutput`.
 */
export function promptPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      'no interactive terminal for a password prompt; set $OPENBUCKET_PASSWORD or $OPENBUCKET_TOKEN',
      EXIT.USAGE,
    );
  }

  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let muted = false;
    // `_writeToOutput` is an internal readline hook; overriding it is the
    // standard way to suppress the echo of typed password characters.
    const rlInternal = rl as unknown as {
      _writeToOutput: (s: string) => void;
      output: NodeJS.WritableStream;
    };
    rlInternal._writeToOutput = (s: string): void => {
      if (!muted) rlInternal.output.write(s);
    };

    rl.question(label, (answer) => {
      rl.close();
      // The muted newline was swallowed above; emit one so the cursor advances.
      process.stdout.write('\n');
      resolve(answer);
    });

    // Everything typed AFTER the label is a secret keystroke → mute now.
    muted = true;
  });
}
