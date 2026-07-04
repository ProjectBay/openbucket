---
id: TASK-2414
title: Wire notification config through options, env schema, AppConfigService, and log redaction
story: STORY-0801
status: backlog
type: infra
size: M
---

## Description
Expose the webhook configuration surface in both deployment modes — the library `OpenBucketModuleOptions.webhooks` block and the standalone env vars — resolve/validate it (fail-closed on a missing/weak secret), surface typed getters on `AppConfigService`, and add the secret to the pino redaction list. This is the config seam [TASK-2412] and [TASK-2413] read from; it also enforces the EPIC-08 secret-strength posture for the new webhook secret.

## Files to create / modify
- `libs/nestjs/src/lib/open-bucket-options.ts` — modify: add a `webhooks?` block to `OpenBucketModuleOptions` + `ResolvedOpenBucketOptions`, apply defaults in `resolveOptions` (line 121), and enforce the secret in `validateSecurityCriticalOptions` (line 174).
- `libs/nestjs/src/lib/common/config/env.schema.ts` — modify: add `WEBHOOK_URL`, `WEBHOOK_SECRET`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_POLL_MS`, `WEBHOOK_EVENTS` to `EnvSchema`.
- `libs/nestjs/src/lib/common/config/app-config.service.ts` — modify: add getters (`webhooksEnabled`, `webhookUrl`, `webhookSecret`, `webhookMaxAttempts`, `webhookTimeoutMs`, `webhookPollMs`, `webhookEvents`).
- `libs/nestjs/src/lib/common/config/config-source.ts` — modify: map the resolved library `webhooks` block into the env-shaped source (mirrors `OPENBUCKET_REGION` / `MAX_OBJECT_SIZE_MB` at lines 35/37).
- `libs/nestjs/src/lib/open-bucket-core.module.ts` — modify: add the webhook secret to the nestjs-pino `redact.paths` list (around line 70).
- `apps/openbucket-backend/.env.example` (or the standalone env docs) — modify: document the new vars.

## Implementation notes
- **Library options** — optional block; presence of `url` enables webhooks:
  ```ts
  webhooks?: {
    url: string;                 // https endpoint (loopback http allowed)
    secret: string;              // HMAC key — validated by strongSecret()
    events?: Array<'object.created' | 'object.deleted' | 'multipart.completed'>; // default: all
    maxAttempts?: number;        // default 8
    timeoutMs?: number;          // default 5000
    pollMs?: number;             // default 15000 (delivery tick interval)
  };
  ```
- **Env schema** (`env.schema.ts`) — reuse `strongSecret` for the secret, gated so it is only required when a URL is present (a `superRefine` on the object, since Zod field-level `.optional()` can't express the cross-field requirement):
  ```ts
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),      // validated by superRefine below when URL set
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  WEBHOOK_POLL_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  WEBHOOK_EVENTS: z.string().default('object.created,object.deleted,multipart.completed'),
  // .superRefine: if WEBHOOK_URL set, run strongSecret('WEBHOOK_SECRET') on WEBHOOK_SECRET
  //               and require URL scheme https unless host is loopback.
  ```
- **URL / SSRF validation (EPIC-08)**: enforce `new URL(url).protocol === 'https:'` unless the host is `localhost`/`127.0.0.1`/`::1` (dev). Reject on a parse failure. The URL is operator-supplied (not tenant-controlled), so this is defence-in-depth, not the primary control; still, block `redirect`-based origin hops at delivery time ([TASK-2413]).
- **`validateSecurityCriticalOptions`** (library mode): extend the Zod object so that when `webhooks?.url` is set, `webhooks.secret` must pass `strongSecret('webhooks.secret')` — same fail-closed contract as `admin.jwtSecret` / `rootCredentials.secretAccessKey`. This is the boot-time guarantee that a standalone/library deployment can't silently sign with a weak/empty webhook secret.
- **`AppConfigService` getters**:
  ```ts
  get webhookUrl(): string | undefined { return this.raw.get('WEBHOOK_URL', { infer: true }); }
  get webhooksEnabled(): boolean { return !!this.webhookUrl; }
  get webhookSecret(): string { return this.raw.get('WEBHOOK_SECRET', { infer: true }) ?? ''; }
  get webhookEvents(): string[] { return this.raw.get('WEBHOOK_EVENTS', { infer: true }).split(',').map(s => s.trim()).filter(Boolean); }
  // + webhookMaxAttempts / webhookTimeoutMs / webhookPollMs
  ```
- **Redaction (secrets hygiene, EPIC-08 / STORY-0705)**: add the secret to the pino `redact.paths` in `open-bucket-core.module.ts` so it never lands in a request/response log; also ensure `config-source.ts` / any config dump path does not echo it. The secret must never be included in an `AuditEvent` or a delivery `lastError`.
- **Defaults keep it off**: with no `WEBHOOK_URL` / `webhooks` block, `webhooksEnabled === false`; the outbox enqueue ([TASK-2412]) and the runner ([TASK-2413]) short-circuit, so pure-embedding users pay nothing.

## Acceptance criteria
- [ ] `WEBHOOK_URL` + `WEBHOOK_SECRET` (env) and `webhooks: { url, secret }` (library) both enable delivery; omitting them leaves `webhooksEnabled === false`.
- [ ] Setting `WEBHOOK_URL` with a missing/weak `WEBHOOK_SECRET` refuses to boot with a clear error (standalone via `EnvSchema`, library via `validateSecurityCriticalOptions`).
- [ ] A non-https, non-loopback `WEBHOOK_URL` is rejected at config time.
- [ ] `AppConfigService.webhookEvents` parses the CSV filter; an unknown event name is ignored by the enqueue gate.
- [ ] The webhook secret is present in the pino `redact.paths` list and is absent from a captured log of a delivery attempt (asserted).
- [ ] `nx test nestjs --testPathPattern="config|options"` passes.

## Test obligations
- Unit: covered by [TEST-0801] (cases 13–15 — resolve/validate/redact, boot-refuse on weak secret, https enforcement).
- E2E: N/A — pure infra/config (exercised indirectly by case 12).
- Conformance: N/A.

## Dependencies
- Blocked by: _none_ structurally, but should land alongside [TASK-2412]/[TASK-2413], which read these getters. Reuses `strongSecret` from [STORY-0705]/EPIC-08.

## References
- `libs/nestjs/src/lib/open-bucket-options.ts:121,174` (`resolveOptions`, `validateSecurityCriticalOptions`).
- `libs/nestjs/src/lib/common/config/env.schema.ts:29` (`strongSecret`), lines 87–95 (limit-var exemplars).
- `libs/nestjs/src/lib/common/config/app-config.service.ts` (getter pattern), `config-source.ts:35,37` (options→env mapping).
- `libs/nestjs/src/lib/open-bucket-core.module.ts:70` (pino `redact.paths`).
</content>
