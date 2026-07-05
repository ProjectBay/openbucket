---
id: TASK-3614
title: Implement output formatting, exit codes, and error mapping
story: STORY-1201
status: backlog
type: implementation
size: S
---

## Description
Provide the shared presentation layer every command uses: aligned human tables,
a `--json` mode, a `--quiet` mode, consistent exit codes, and a single
error-to-message mapper that redacts secrets. Centralizing this keeps commands
thin and guarantees uniform, safe output.

## Files to create / modify
- `libs/nestjs/src/cli/output.ts` — new (`printTable`, `printJson`, `printKeyValue`)
- `libs/nestjs/src/cli/errors.ts` — modify (extend the `CliError` from TASK-3611: `exitCode`, `toStderr()`, `redact()`)
- `libs/nestjs/src/cli/index.ts` — modify (top-level try/catch → exit code)

## Implementation notes
- Exit codes (returned by `runCli`, applied only by `index.ts`):
  - `0` success; `1` generic/runtime error; `2` usage error (bad args/unknown
    command); `3` auth error (`401`); `4` rate-limited (`429`). Keep the mapping in
    `CliError.exitCode` so tests assert it.
- `output.ts`:
  - `printTable(rows, columns)` — compute column widths, pad, write to stdout.
    No color dependency; optional ANSI only when `process.stdout.isTTY`.
  - Under `--json`, commands call `printJson(value)` (single `JSON.stringify(value, null, 2)`
    to stdout, nothing else — so stdout stays pipeable). Under `--quiet`, suppress
    tables/notices but still emit the essential datum (e.g. a created bucket name).
- `errors.ts` `redact(s: string): string`:
  - Strip bearer tokens (`/Bearer\s+[A-Za-z0-9._-]+/`), JWT-looking triples
    (`/eyJ[A-Za-z0-9._-]{10,}/`), and any `secretAccessKey`/`password` JSON field
    value before anything reaches stderr. Applied in `toStderr()` so EVERY error
    path is redacted by construction — preserving the EPIC-08 secret-redaction
    posture (the same reason `/metrics` must not leak secrets).
  - Human errors go to **stderr**; data goes to **stdout**. Never print stack
    traces unless `OPENBUCKET_DEBUG=1`, and even then run them through `redact`.
- Edge cases:
  - The one deliberate exception to redaction is the `secretAccessKey` on
    `keys create`, which is *data* on **stdout**, printed once by TASK-3612 — not
    routed through the error path.
  - Unhandled promise rejection at top level → map to exit `1` and a redacted
    one-liner; never a raw Node stack dump.

## Acceptance criteria
- [ ] Success exits `0`; usage error exits `2`; `401` exits `3`; `429` exits `4`.
- [ ] `--json` output is a single valid JSON document on stdout with no table/notice noise.
- [ ] A synthetic error message containing a `Bearer <jwt>` and a `secretAccessKey` is fully redacted by `toStderr()`.
- [ ] Errors are written to stderr and data to stdout (verified by redirecting each stream independently).

## Test obligations
- Unit: covered by [TEST-1201] (exit-code map, `redact` regexes, stdout/stderr split)
- E2E: covered by [TEST-1201] (`--json` piped through `jq`; exit codes asserted)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3610]

## References
- `libs/nestjs/src/lib/common/filters/admin-exception.filter.ts` — server JSON error shape the mapper reads
- EPIC-08 security posture — secret redaction / `/metrics` never leaks secrets
- `libs/nestjs/src/cli/errors.ts` (created in TASK-3611)
