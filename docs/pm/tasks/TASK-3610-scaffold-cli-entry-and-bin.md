---
id: TASK-3610
title: Scaffold the openbucket CLI entry, config resolution, and bin wiring
story: STORY-1201
status: backlog
type: implementation
size: S
---

## Description
Create the `openbucket` command skeleton: a shebang entrypoint that parses the
top-level command/subcommand, resolves endpoint + credentials from flags/env,
and dispatches to per-command handlers (stubbed here, filled by TASK-3612/3613).
Register it as a `bin` of `@openbucket/nestjs` and make `nx build nestjs` compile
it. No business logic yet — just wiring, config, `--help`, and exit-code plumbing.

## Files to create / modify
- `libs/nestjs/src/cli/index.ts` — new (entry: `#!/usr/bin/env node`; `runCli(argv): Promise<number>`; `process.exit(await runCli(process.argv.slice(2)))`)
- `libs/nestjs/src/cli/args.ts` — new (minimal flag parser + command router; no external dep)
- `libs/nestjs/src/cli/config.ts` — new (`resolveConfig(flags, env): CliConfig`)
- `libs/nestjs/package.json` — modify (add `bin`)
- `libs/nestjs/tsconfig.lib.json` / build inputs — modify only if `src/cli` is excluded from the lib compile (verify it is picked up)

## Implementation notes
- Zero runtime deps — Node built-ins only (`node:process`, `node:util.parseArgs`).
  Use `parseArgs` from `node:util` (stable since Node 18) rather than adding
  `commander`/`yargs`; this keeps the 3-place native-dep externalization rule
  (webpack `externalDependencies`, the standalone `package.json`, the Docker
  runtime base — see `apps/openbucket-backend/webpack.config.js`) untouched and
  avoids dragging Angular in transitively.
- `bin` entry:
  ```json
  "bin": { "openbucket": "./src/cli/index.js" }
  ```
  `files` already includes `src`, so the compiled `src/cli/index.js` ships. The
  emitted JS must keep the shebang (tsc preserves a leading `#!` line).
- `CliConfig` shape and resolution precedence (flag > env > prompt):
  ```ts
  interface CliConfig {
    endpoint: string;       // OPENBUCKET_ENDPOINT | --endpoint, e.g. http://127.0.0.1:3900
    username?: string;      // OPENBUCKET_USERNAME | --username
    token?: string;         // OPENBUCKET_TOKEN — skip login when present
    json: boolean;          // --json
    quiet: boolean;         // --quiet
    insecure: boolean;      // --insecure (allow non-loopback plain http)
  }
  ```
  Password is intentionally NOT a field here and NOT a flag — it is read only
  from `$OPENBUCKET_PASSWORD` or the prompt (TASK-3611), so it never lands on
  `argv`/`ps`.
- Command table: `buckets`, `keys`, `backup`, `replication`, plus `--help`/`--version`.
  Unknown command or missing required positional → print usage to stderr, return
  a non-zero code. Normalize `endpoint` by stripping a trailing `/`.
- Edge cases / security: reject an `http://` endpoint whose host is not
  loopback unless `--insecure` is set (creds would traverse plaintext). Never
  echo the resolved config object (it may hold `token`). `runCli` returns a
  number; only `index.ts` calls `process.exit` so the module stays testable.

## Acceptance criteria
- [ ] `openbucket --help` and `openbucket --version` exit `0` and print to stdout.
- [ ] `openbucket bogus` prints usage to stderr and exits non-zero.
- [ ] `resolveConfig` honours flag > env precedence and never reads a password from `argv`.
- [ ] `libs/nestjs/package.json` has `bin.openbucket === "./src/cli/index.js"` and `nx build nestjs` emits `dist/libs/nestjs/src/cli/index.js` with an intact shebang.

## Test obligations
- Unit: covered by [TEST-1201] (config precedence, endpoint validation, help/exit codes)
- E2E: covered by [TEST-1201] (`node dist/.../cli/index.js --help`)
- Conformance: N/A — CLI, not S3 surface

## Dependencies
- Blocked by: —

## References
- `libs/nestjs/package.json` (no `bin` today; `files: ["src", "assets", "README.md"]`)
- `apps/openbucket-backend/webpack.config.js` — `externalDependencies` derivation (native-dep externalization)
- `docs/AGENT-WORKFLOW.md` — "native deps stay external"
