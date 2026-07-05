---
title: The openbucket CLI
description: Manage buckets, keys, backups, and replication from the terminal — dependency-free and credential-safe.
sidebar_position: 10
---

# The `openbucket` CLI

Drive the admin API from your shell or a CI job: list and create buckets, mint scoped access keys, take and restore backups, and check replication — all without touching a browser.

## First run

The CLI ships inside `@openbucket/nestjs` as an `openbucket` bin, so once the package is installed you can run it with `npx` (or a global install):

```bash
# Point it at your instance and identify yourself:
export OPENBUCKET_ENDPOINT=https://your-host/storage   # default http://127.0.0.1:3900
export OPENBUCKET_USERNAME=admin
export OPENBUCKET_PASSWORD=…                            # or omit to be prompted (no echo)

npx openbucket buckets ls
```

That's it. The password is exchanged for a short-lived bearer token in memory, the request goes out, and you get a table back.

:::note The endpoint is your admin base URL
`OPENBUCKET_ENDPOINT` is the host **plus `mountPath`** — the same base the admin API lives under (`<endpoint>/api/admin/*`). Standalone at the root is `http://your-host:9000`; embedded is `http://your-host/storage`. The default `http://127.0.0.1:3900` matches a local dev server.
:::

## Configuring endpoint & credentials

Everything is set by env var or flag, with **flag over env** precedence:

| What | Env | Flag |
| --- | --- | --- |
| Admin endpoint | `OPENBUCKET_ENDPOINT` | `--endpoint <url>` |
| Admin username | `OPENBUCKET_USERNAME` | `--username <u>` |
| Password | `OPENBUCKET_PASSWORD` | *(none — never a flag)* |
| Existing bearer token | `OPENBUCKET_TOKEN` | *(none)* |

**The password is never a flag.** It's read only from `OPENBUCKET_PASSWORD` or an interactive, non-echoing prompt — so it can't land on `argv` or in `ps` output. Set `OPENBUCKET_TOKEN` to reuse an existing bearer token and skip login entirely (handy in CI, where there's no TTY to prompt).

:::warning Plaintext credentials
The CLI refuses to send credentials over plain `http://` to a **non-loopback** host. Use `https`, or — if you really mean it on a trusted network — pass `--insecure`.
:::

Global output flags:

- `--json` — one machine-readable JSON document on stdout (pipe it into `jq`).
- `--quiet` — suppress notices; emit only the essential datum (bucket names, key IDs).

## Buckets

```bash
openbucket buckets ls                                   # list buckets
openbucket buckets mb reports --versioning enabled      # make a bucket
openbucket buckets mb locked --object-lock              # make a lock-enabled bucket
openbucket buckets rb reports                           # remove an (empty) bucket
```

`buckets mb` options: `--versioning enabled|disabled` (default `disabled`), `--object-lock` (a flag), and `--region <r>` (default `us-east-1`). Bucket names are validated **client-side** first, so a bad name issues no request — not even a login.

Removing a non-empty bucket returns the server's `BucketNotEmpty` message verbatim; empty it first.

## Access keys

Mint **scoped sub-keys** confined to a bucket and prefix with `--scope prefix:<bucket>/<prefix>`:

```bash
openbucket keys list
openbucket keys create --label ci --scope prefix:reports/2026/
openbucket keys revoke <id>                             # reversible disable
```

The `create` output prints the `secretAccessKey` **exactly once** — it's data on stdout, and the server never shows it again:

```text
id              …
accessKeyId     AKIA…
secretAccessKey …          ← store this now; it is not shown again
role            …
scope           prefix:reports/2026/
```

Omit `--scope` for an unrestricted (root-role) key. The scope shorthand is parsed and validated client-side, so a malformed shape fails fast without hitting the API.

:::tip Capture the secret in CI
Use `--json` and read the field: `openbucket keys create --label ci --json | jq -r .secretAccessKey`. The redactor still keeps the secret out of every error path — it only ever appears on this one success line.
:::

## Backup & restore

Snapshots are streamed `.zip` files — whole-instance or a single bucket:

```bash
openbucket backup create -o snapshot.zip                  # whole instance
openbucket backup create --bucket reports -o reports.zip  # one bucket
openbucket backup restore -f snapshot.zip --yes           # RESETS the target
```

`backup create` picks a timestamped default filename if you omit `-o` (`--output`); pass `--force` to overwrite an existing file.

`backup restore` reads the archive with `-f` (`--file`) and **resets** the target instance or bucket, so it's gated behind an explicit `--yes`. Without `--yes` it issues **no request at all** (not even a login) and exits with a usage error — CI-safe, no interactive confirm to hang on. Scope a restore to one bucket with `--bucket <b>`.

## Replication

```bash
openbucket replication status
```

Shows enabled/disabled, the outbox depth (`pending` / `inflight` / `failed`), the oldest pending age, the last error message, and a per-bucket breakdown. It **always succeeds** — an unconfigured replication is `disabled`, not an error. No remote endpoint or credential is ever surfaced.

## Exit codes

Scriptable and stable:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Generic / runtime error |
| `2` | Bad args / unknown command |
| `3` | Auth failure (401) |
| `4` | Rate-limited (429) |

Data goes to **stdout**; human-readable errors go to **stderr**, run through a central redactor that strips bearer tokens, JWTs, and `secretAccessKey` / `password` values before anything is printed. A `429` is surfaced but never auto-retried (that would only deepen the login throttle).

:::note Zero dependencies
The CLI is built entirely on Node built-ins (`fetch`, `parseArgs`, `readline`) — installing `@openbucket/nestjs` drags nothing extra into your tree for it.
:::

## Next steps

- [Admin console](./admin-console.md) — the same operations in a browser, plus editors, search, and the audit log.
- [Observability](./observability.md) — scrape replication and integrity as Prometheus metrics.
- [NestJS module reference](../reference/nestjs-module.md) — the admin API these commands call.
