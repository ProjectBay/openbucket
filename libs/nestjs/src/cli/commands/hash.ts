/**
 * `openbucket hash [password]` — generate an argon2id hash for the admin
 * password (the `ADMIN_PASSWORD_HASH` env var / `admin.passwordHash` option).
 *
 * A local, OFFLINE utility: it never contacts the admin API and needs no
 * credentials, so it works straight from `npx @openbucket/nestjs hash` with no
 * repository checkout — the missing on-ramp for embed users, who previously had
 * no shipped way to mint the hash the module requires at boot.
 *
 * The password comes from the positional argument, else `$OPENBUCKET_PASSWORD`,
 * else a non-echoing prompt — it is never echoed and never leaves the machine.
 * Only the resulting hash is printed to stdout, so it composes:
 *
 *   ADMIN_PASSWORD_HASH="$(openbucket hash 'my-strong-password')"
 *   npx @openbucket/nestjs hash            # then type it at the prompt
 */

import { CliError, EXIT } from '../errors';
import { printLine } from '../output';
import { promptPassword } from '../prompt';

export async function runHash(
  positionals: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  // Precedence: positional arg → $OPENBUCKET_PASSWORD → interactive prompt.
  // A `--flag` is deliberately unsupported so the prompt path keeps the secret
  // out of shell history; a positional mirrors the legacy helper script and
  // stays scriptable.
  let password = positionals[0] ?? env.OPENBUCKET_PASSWORD;
  if (password === undefined) {
    password = await promptPassword('Password to hash: ');
  }
  if (!password) {
    throw new CliError('empty password — nothing to hash', EXIT.USAGE);
  }

  // argon2 is a native module and a runtime dependency of the package; load it
  // lazily so unrelated CLI commands don't pay its startup cost.
  const argon2 = await import('argon2');
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  printLine(hash);
  return EXIT.SUCCESS;
}
