---
id: TASK-2413
title: Implement signed webhook delivery (WebhookSigner + WebhookDeliveryRunner)
story: STORY-0801
status: backlog
type: implementation
size: L
---

## Description
Drain the `event_deliveries` outbox and POST each event to the configured URL with an HMAC-SHA256 signature, exponential backoff with jitter, a per-request timeout, bounded retries with a dead-letter terminal state, and retention pruning of terminal rows. Implemented as a `ScheduledTask` (`WebhookDeliveryRunner`) registered on the existing in-process background tick, plus a pure `WebhookSigner`. This is the standalone durability half of the Story; the in-process path ([TASK-2411]) is unaffected.

## Files to create / modify
- `libs/nestjs/src/lib/events/webhook-signer.ts` — new (pure HMAC signing + header formatting).
- `libs/nestjs/src/lib/events/webhook-delivery.runner.ts` — new (`WebhookDeliveryRunner implements ScheduledTask`).
- `libs/nestjs/src/lib/persistence/repositories/event-delivery.repository.ts` — new (due-scan + terminal-prune queries).
- `libs/nestjs/src/lib/persistence/index.ts` — modify: export the repository.
- `libs/nestjs/src/lib/common/background/background.module.ts` — modify: add `WebhookDeliveryRunner` to `providers` AND to the `SCHEDULED_TASKS` factory `inject` list (lines 21–30); import `EventsModule` if the signer/config aren't otherwise resolvable.
- `libs/nestjs/src/lib/events/events.module.ts` — modify: provide+export `WebhookSigner` (and the repository if not global).

## Implementation notes
- **Signer** (Stripe-style, timestamped to defeat replay); constant-time on the receiver side, documented in the README recipe:
  ```ts
  sign(rawBody: string, secret: string, now = Date.now()): { header: string; timestamp: number } {
    const t = Math.floor(now / 1000);
    const mac = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return { header: `t=${t},v1=${mac}`, timestamp: t };
  }
  ```
  The signature covers `"<timestamp>.<rawBody>"` so a receiver can reject stale timestamps. Emit headers `X-OpenBucket-Event: <type>`, `X-OpenBucket-Delivery: <row.id>`, `X-OpenBucket-Signature: <header>`, `Content-Type: application/json`, and a `User-Agent: openbucket-webhooks/<version>` (reuse `version.ts`).
- **Runner** mirrors `TrashPurgeRunner` (`common/background/trash-purge.runner.ts`): `name`, `intervalMs` (from config, default 15_000), a batched due-scan, `setImmediate` yields between batches, per-row failure isolation, and it reads the `Clock` (`common/clock/clock.ts`) so tests fast-forward backoff.
  ```ts
  async run(): Promise<void> {
    if (!this.config.webhooksEnabled) return;
    const due = await this.repo.findDue(this.clock.now(), BATCH);   // status='pending' AND next_attempt_at <= now, ORDER BY next_attempt_at, LIMIT n
    for (const row of due) { await this.deliverOne(row); }
    await this.repo.pruneTerminal(this.clock.now(), RETENTION_MS);   // delete delivered/failed older than retention
  }
  ```
- **HTTP** uses Node global `fetch` with an `AbortController` timeout (`config.webhookTimeoutMs`, default 5000) — no new dependency. 2xx ⇒ `status='delivered'`, `deliveredAt=now`. Non-2xx / network error / timeout ⇒ increment `attempts`; if `attempts >= config.webhookMaxAttempts` (default 8) ⇒ `status='failed'` (dead-letter) with `lastError` truncated to 512 chars; else keep `pending` and set `nextAttemptAt = now + backoff(attempts)`.
- **Backoff**: `min(baseMs * 2^attempts, capMs)` with full jitter — e.g. `base=2s`, `cap=1h`; `nextAttemptAt = now + random(0, min(2s * 2^attempts, 1h))`. Jitter prevents a thundering-herd retry after the endpoint recovers.
- **No-pile-up**: `BackgroundService.fire` already skips a tick while the previous is in-flight (`background.service.ts:88`), so a slow endpoint cannot stack overlapping runs; the per-request `AbortController` bounds a single slow delivery so one bad row can't monopolize a tick.
- **At-least-once, not exactly-once**: a crash after the endpoint returns 2xx but before the row is marked `delivered` re-delivers. Receivers dedupe on `X-OpenBucket-Delivery` (the row id) — document this. Deliveries are processed in `next_attempt_at` order (best-effort), NOT strictly per-key ordered.
- **Security / SSRF (EPIC-08 posture)**: the target URL is operator-configured (not user/tenant-controlled), so the SSRF surface is low, but still: require `https` unless the host is loopback/`http`-explicitly-allowed (validated in [TASK-2414]); never follow redirects to a different origin (`redirect: 'manual'`, treat 3xx as failure); cap response body read (we only need the status). The HMAC **secret is never logged** — `lastError` stores only the status code / error name, and the signature/secret are excluded from any log line. A failed delivery logs `deliveryId`, `eventType`, `attempts`, `status` — never the payload body at info level.
- **DoS / growth (CWE-770)**: `findDue` is `LIMIT BATCH` so a backlog is drained in bounded chunks; `pruneTerminal` bounds table size; `webhookMaxAttempts` bounds per-row work; the dead-letter state stops infinite retries against a permanently-down endpoint.

## Acceptance criteria
- [ ] A pending row with a stub endpoint returning 200 transitions to `delivered` with `deliveredAt` set, in one tick.
- [ ] The POST carries a valid `X-OpenBucket-Signature: t=…,v1=…` verifiable by recomputing `HMAC(secret, "t.rawBody")`, plus `X-OpenBucket-Event`/`X-OpenBucket-Delivery`.
- [ ] A 500/timeout leaves the row `pending`, increments `attempts`, and pushes `nextAttemptAt` forward by a jittered exponential backoff; after `maxAttempts` the row is `failed` with a truncated `lastError`.
- [ ] A slow endpoint is aborted at `webhookTimeoutMs` and does not stall subsequent ticks (no-pile-up honored).
- [ ] Terminal rows past retention are pruned; the secret never appears in any log output (asserted).
- [ ] `WebhookDeliveryRunner` is discovered by `BackgroundService` (present in the `SCHEDULED_TASKS` array).
- [ ] `nx test nestjs --testPathPattern="webhook"` passes.

## Test obligations
- Unit: covered by [TEST-0801] (cases 8–11 — signer vectors, backoff math, dead-letter, prune).
- E2E: covered by [TEST-0801] (case 12 — real PUT ⇒ signed POST received by a local listener).
- Conformance: N/A.

## Dependencies
- Blocked by: [TASK-2412] (`EventDeliveryEntity` + outbox rows), [TASK-2414] (webhook config getters + URL validation).

## References
- `libs/nestjs/src/lib/common/background/trash-purge.runner.ts` (runner exemplar: batching, `Clock`, per-item isolation).
- `libs/nestjs/src/lib/common/background/background.service.ts:88` (no-pile-up), `background.module.ts:21-30` (`SCHEDULED_TASKS` factory).
- `libs/nestjs/src/lib/common/clock/clock.ts`, `libs/nestjs/src/lib/version.ts`.
- Node `fetch` + `AbortController`; `node:crypto` `createHmac`.
</content>
