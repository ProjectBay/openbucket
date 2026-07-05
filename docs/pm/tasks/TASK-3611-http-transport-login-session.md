---
id: TASK-3611
title: Implement the fetch transport, login/JWT session, and secret-safe prompt
story: STORY-1201
status: backlog
type: implementation
size: M
---

## Description
Build the transport layer the commands sit on: a thin `fetch`-based HTTP client
that logs in for a JWT, attaches it as a bearer token, and maps HTTP status codes
to typed errors. Add a non-echoing password prompt that only runs on a TTY. This
is the security-critical Task: credentials must never touch `argv` or disk in
plaintext, and tokens/secrets must never be logged.

## Files to create / modify
- `libs/nestjs/src/cli/http-client.ts` — new (`request<T>()`, `download()`, `upload()`)
- `libs/nestjs/src/cli/session.ts` — new (`acquireToken(config): Promise<string>`)
- `libs/nestjs/src/cli/prompt.ts` — new (`promptPassword(label): Promise<string>`)
- `libs/nestjs/src/cli/errors.ts` — new (shared with TASK-3614: `CliError`, `fromResponse()`)

## Implementation notes
- Use the global `fetch`/`Headers`/`Response` (Node ≥ 20.19.0 per
  `engines.node`) — no `node-fetch`/`axios`, keeping deps at zero.
- `acquireToken`:
  ```ts
  async function acquireToken(cfg: CliConfig): Promise<string> {
    if (cfg.token) return cfg.token;                 // OPENBUCKET_TOKEN short-circuit
    const password =
      process.env.OPENBUCKET_PASSWORD ?? (await promptPassword(`Password for ${cfg.username}: `));
    const body: LoginDto = { username: cfg.username!, password };
    const res = await request<LoginResponseDto>(cfg, 'POST', '/api/admin/auth/login', { body });
    return res.accessToken; // { accessToken, expiresIn } — refresh cookie ignored (CLI is stateless)
  }
  ```
  Import `LoginDto` / `LoginResponseDto` **type-only** from `@openbucket/api-client`
  so nothing from the Angular services bundle is emitted:
  `import type { LoginDto, LoginResponseDto } from '@openbucket/api-client';`.
- `request<T>()`: sets `Authorization: Bearer <token>` when a token is passed,
  `Content-Type: application/json` for JSON bodies, parses JSON on 2xx, and on
  non-2xx throws `CliError` via `fromResponse(res)` — reading the admin exception
  filter's JSON error shape (`{ statusCode, message }`) when present. Never
  include request headers (which carry the bearer token) in the thrown message.
- `promptPassword`: use `node:readline` with `output` muted (`terminal: true`,
  swap the `_writeToOutput` to emit nothing for the password line) or toggle
  `process.stdin` raw mode. If `!process.stdin.isTTY`, do NOT prompt — throw a
  `CliError` telling the user to set `$OPENBUCKET_PASSWORD` or `$OPENBUCKET_TOKEN`
  (keeps the CLI usable in CI without hanging).
- Rate-limit handling: the login route is `@Throttle({ login: { limit: 5, ttl: 60_000 } })`.
  On `429`, surface `Retry-After` (or "≤60s") in the message and do NOT auto-retry
  — a retry loop would deepen the throttle. Login is attempted at most once per
  invocation.
- Security / DoS:
  - Password sourced only from env or prompt; never a flag, never echoed, never
    written to disk. Token held in memory for the process lifetime only.
  - Redact defensively: `fromResponse` and any logger must strip `Bearer` tokens
    and any `secretAccessKey`/`password` field before printing (preserves the
    EPIC-08 secret-redaction posture — mirrors `/metrics` never leaking secrets).
  - `download`/`upload` stream to/from disk (see TASK-3613) — never buffer whole
    archives in memory.

## Acceptance criteria
- [ ] `acquireToken` returns the env token unchanged when `OPENBUCKET_TOKEN` is set (no login call).
- [ ] With only `OPENBUCKET_PASSWORD` set, login succeeds against a live instance and returns a usable bearer token.
- [ ] A `401` yields a `CliError` whose message is "invalid credentials" and contains no token/password substring.
- [ ] A `429` message mentions rate limiting and no second request is issued.
- [ ] With no TTY and no `OPENBUCKET_PASSWORD`/`OPENBUCKET_TOKEN`, the CLI exits non-zero with an instructive message instead of hanging.

## Test obligations
- Unit: covered by [TEST-1201] (status→error mapping, redaction, non-TTY guard)
- E2E: covered by [TEST-1201] (real login against the spawned backend)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-3610]

## References
- `libs/nestjs/src/lib/admin/auth/auth.controller.ts` — login route + `@Throttle` limit
- `libs/nestjs/src/lib/admin/auth/auth.service.ts` — `login(username, password)` throws `UnauthorizedException('invalid credentials')`
- `libs/api-client/src/lib/model/login-dto.ts`, `login-response-dto.ts`
- `libs/nestjs/src/lib/common/filters/admin-exception.filter.ts` — JSON error shape
