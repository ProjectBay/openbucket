---
title: CLI reference
description: The dependency-free openbucket CLI — every command, argument, flag, and exit code for scripting a running instance.
sidebar_position: 4
---

# CLI reference

`openbucket` is a dependency-free command-line client over the admin JSON API:
bucket and key management, backup/restore, and replication status. It ships in
the `@openbucket/nestjs` package, credentials never touch `argv`, and every error
path is redacted before it reaches stderr — safe to script. The one exception is
[`hash`](#hash), a purely **offline** helper that talks to no server at all.

```bash
# List buckets on a running instance (log in with a prompted password):
npx openbucket buckets ls --endpoint http://localhost:9000 --username admin
```

The password is read from `$OPENBUCKET_PASSWORD` or an interactive non-echoing
prompt — **never** a flag. Set `$OPENBUCKET_TOKEN` to reuse a bearer token and
skip login entirely.

:::note[Default endpoint]
`--endpoint` defaults to `http://127.0.0.1:3900` (the dev-serve port). For a
standalone Docker instance, pass `--endpoint http://127.0.0.1:9000` or set
`$OPENBUCKET_ENDPOINT`.
:::

## Global options

| Flag | Env | Notes |
| --- | --- | --- |
| `--endpoint <url>` | `OPENBUCKET_ENDPOINT` | Admin endpoint. Default `http://127.0.0.1:3900`. |
| `--username <u>` | `OPENBUCKET_USERNAME` | Admin username. |
| `--json` | | Machine-readable JSON output. |
| `--quiet` | | Suppress notices; emit only the essential datum. |
| `--insecure` | | Allow credentials over non-loopback plaintext `http`. |
| `-h`, `--help` | | Show usage. |
| `--version` | | Print the version. |

Credentials env vars: `$OPENBUCKET_PASSWORD` (or a prompt) supplies the password;
`$OPENBUCKET_TOKEN` supplies a bearer token to skip login. Set `OPENBUCKET_DEBUG=1`
for a redacted stack trace on failure.

## Commands

### `buckets`

| Command | Arguments | Description |
| --- | --- | --- |
| `buckets ls` | | List buckets (name, versioning, object-lock, count, size, created). |
| `buckets mb <name>` | `[--versioning enabled\|disabled]` `[--object-lock]` `[--region <r>]` | Create a bucket. Name validated client-side; `--versioning` defaults to `disabled`, `--region` to `us-east-1`. |
| `buckets rb <name>` | | Remove an **empty** bucket (`409` if not empty). |

```bash
openbucket buckets mb photos --versioning enabled --object-lock
openbucket buckets ls --json
```

### `keys`

| Command | Arguments | Description |
| --- | --- | --- |
| `keys list` | | List access keys (id, access-key-id, label, role, disabled, scope, last-used). |
| `keys create` | `--label <l>` `[--scope prefix:<bucket>/<prefix>]` | Mint an access key. The `secretAccessKey` is printed **once** as data on stdout. |
| `keys revoke <id>` | | Disable (reversibly) an access key. |

```bash
openbucket keys create --label tenant-42 --scope prefix:uploads/tenant-42/
```

:::warning[The secret is shown once]
`keys create` prints `secretAccessKey` exactly once — capture it immediately.
Under `--json` the whole created-key DTO is emitted so it can be captured
machine-readably.
:::

### `backup`

| Command | Arguments | Description |
| --- | --- | --- |
| `backup create` | `[--bucket <b>]` `[-o, --output <file.zip>]` `[--force]` | Download a `.zip` snapshot — whole-instance, or one bucket with `--bucket`. Default filename is timestamped. `--force` overwrites an existing file. |
| `backup restore` | `-f, --file <file.zip>` `[--bucket <b>]` `--yes` | Restore from a snapshot. **Resets** the target — gated behind explicit `--yes`. |

```bash
openbucket backup create -o nightly.zip
openbucket backup restore -f nightly.zip --yes
```

:::warning[Restore resets the target]
`backup restore` resets the instance (or the named bucket) before restoring. It
issues **no request at all** — not even a login — unless you pass `--yes`.
:::

### `replication`

| Command | Arguments | Description |
| --- | --- | --- |
| `replication status` | | Show replication health: enabled, pending/inflight/failed depth, oldest-pending age, last error, and a per-bucket breakdown. Never surfaces a remote endpoint or credential. Exits `0` even when replication is disabled. |

```bash
openbucket replication status --quiet   # prints "enabled" or "disabled"
```

### `hash`

| Command | Arguments | Description |
| --- | --- | --- |
| `hash` | `[password]` | Print an argon2id hash for `ADMIN_PASSWORD_HASH` / `admin.passwordHash`. **Offline** — issues no request. |

```bash
# No repo checkout needed — the command ships in @openbucket/nestjs:
npx @openbucket/nestjs hash 'choose-a-strong-password'

ADMIN_PASSWORD_HASH="$(openbucket hash 'choose-a-strong-password')"
openbucket hash            # omit the arg to be prompted (no echo)
```

The password is read from the positional argument, else `$OPENBUCKET_PASSWORD`,
else an interactive non-echoing prompt — **never** a flag, so it can't land on
`argv`. Only the resulting hash is written to stdout.

:::note[This command is offline — unlike every other one]
`hash` needs **no `--endpoint`, no login, and no credentials**. It never contacts
the admin API — it just computes a hash locally and prints it. That makes it the
on-ramp for embed users who have no repository checkout: `npx @openbucket/nestjs
hash '<password>'` mints the hash the module requires at boot, with nothing else
installed. (From a repo clone, `node scripts/hash-password.mjs '<password>'` does
the same thing.)
:::

## Exit codes

| Code | Meaning |
| :-: | --- |
| `0` | Success. |
| `1` | Generic / runtime error. |
| `2` | Bad arguments or unknown command (usage error). |
| `3` | Authentication failed (`401` — invalid credentials). |
| `4` | Rate limited (`429`; the CLI does not auto-retry). |

## Next steps

- [Admin API](./admin-api.md) — the JSON API the CLI wraps.
- [Configuration](./configuration.md) — replication, backups, and scoped keys.
- [S3 compatibility](./s3-compatibility.md) — the data plane the CLI complements.
