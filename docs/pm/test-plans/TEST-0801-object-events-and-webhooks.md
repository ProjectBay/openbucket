---
id: TEST-0801
title: Object events and signed-webhook delivery
covers: [STORY-0801, TASK-2410, TASK-2411, TASK-2412, TASK-2413, TASK-2414]
status: backlog
level: integration
---

## Goal
Verify that the three object events fire exactly once at the commit boundary for every S3 and admin/library write/delete path, that in-process handlers are typed and error-isolated, and that the standalone webhook path is a durable transactional outbox with correct HMAC signing, exponential-backoff retries, dead-lettering, and fail-closed config.

## Setup
- Jest + the existing `nestjs` unit harness for the service/runner units; the `nestjs-e2e` app (supertest + `@aws-sdk/client-s3`) for the wire path.
- A libsql DB in a temp `DATA_DIR` with the `Migration20260702000001_event_deliveries` migration applied (boot migrator).
- A controllable `Clock` (`common/clock/clock.ts`) to fast-forward backoff without real sleeps.
- A local HTTP listener (Node `http.createServer` on `127.0.0.1:0`) as the webhook receiver, with switchable responses (200 / 500 / hang-past-timeout) and a captured-request log (headers + raw body).
- A test module that registers a probe provider with `@OnObjectCreated()` / `@OnObjectDeleted()` / `@OnMultipartCompleted()` collecting received payloads.
- Webhook-enabled config: `webhooks: { url: <listener>, secret: <32+ char strong secret>, pollMs: small, maxAttempts: 3 }`.

## Cases
1. **In-process contract (TASK-2410)** — Given the probe provider, when `ObjectEventsService.emitInProcess({type:'object.created',…})` fires, then the `@OnObjectCreated` method receives the exact `{type,bucket,key,size,etag,versionId,eventTime}` payload and `eventTime` parses as ISO-8601.
2. **Handler error isolation (TASK-2410)** — Given a handler that throws, when `emitInProcess` fires, then it returns synchronously, does not reject, and the error is logged; a second healthy handler still runs.
3. **Single `forRoot` (TASK-2410)** — Assert `EventEmitterModule.forRoot(` appears exactly once in the module graph (grep + a boot smoke test that the app initializes).
4. **`object.created` on every write path (TASK-2411)** — Given a bucket, when an object is stored via S3 `PutObject`, admin `OpenBucketService.putObject`, and S3 `CopyObject`, then each produces exactly one `object.created` with correct `size`/`etag` (and `versionId` only when versioning is on).
5. **`multipart.completed` (TASK-2411)** — Given a 2-part multipart upload, when `CompleteMultipartUpload` commits, then exactly one `multipart.completed` fires carrying the `<hex>-2` multipart ETag.
6. **`object.deleted` + idempotency (TASK-2411)** — Given an existing key, when deleted via S3 `DeleteObject`, bulk `DeleteObjects`, and admin delete, then `object.deleted` fires once each; a repeat delete of an already-absent key fires nothing.
7. **No event on rollback (TASK-2411)** — Given a forced commit failure (fault injection in `putLocked`), when the write aborts, then no in-process event fires and `event_deliveries` is empty (F2/F3 no-op preserved).
8. **Transactional outbox insert (TASK-2412)** — Given webhooks enabled, when a write commits, then exactly one `pending` `event_deliveries` row exists whose `payload` JSON round-trips to the emitted event; with webhooks disabled, zero rows.
9. **Outbox rolls back with the write (TASK-2412)** — Given a forced rollback, when the write aborts, then zero `event_deliveries` rows (proves the enqueue is in the write's transaction).
10. **Signing vector (TASK-2413)** — Given a known body + secret + fixed clock, assert `X-OpenBucket-Signature` equals `t=<t>,v1=<HMAC-SHA256(secret, "<t>.<body>")>` and the receiver can independently recompute it; assert `X-OpenBucket-Event` and `X-OpenBucket-Delivery` (= row id) are present.
11. **Retry / backoff / dead-letter (TASK-2413)** — Given the listener returns 500, when the tick runs, then the row stays `pending`, `attempts` increments, and `nextAttemptAt` advances by a bounded exponential (each retry only fires after fast-forwarding the Clock past `nextAttemptAt`); after `maxAttempts=3` the row becomes `failed` with a truncated `lastError`. A separate sub-case: a listener that hangs past `timeoutMs` is aborted and treated as a failure without stalling the next tick.
12. **End-to-end delivery (TASK-2411/2412/2413)** — Given webhooks enabled and the listener returning 200, when a real S3 `PutObject` runs through the wire, then within a tick the receiver observes one POST with a valid signature and the row transitions to `delivered` with `deliveredAt` set; a restart with an undelivered `pending` row (listener down at write time, up after restart) still delivers (durability).
13. **Fail-closed config (TASK-2414)** — Given `WEBHOOK_URL` set with a missing/weak `WEBHOOK_SECRET`, when the app boots, then it refuses to start with a clear error (standalone via `EnvSchema`; library via `validateSecurityCriticalOptions`).
14. **URL scheme enforcement (TASK-2414)** — Given a non-https, non-loopback `WEBHOOK_URL`, then config validation rejects it; an `https://` or `http://127.0.0.1` URL is accepted.
15. **Secret redaction (TASK-2414)** — Assert the webhook secret is in the pino `redact.paths` list and does NOT appear in captured logs of a delivery attempt, nor in any `event_deliveries.last_error` value.

## Tooling
- Framework: jest | supertest | @aws-sdk/client-s3 | Node `http` (stub receiver) | `node:crypto` (signature recompute)
- Runner: `nx test nestjs` (units: events, object-writer, object.service, webhook, config) / `nx e2e nestjs-e2e` (cases 4–6, 12)

## Pass criteria
- [ ] Cases 1–3 pass (in-process contract + isolation + single forRoot).
- [ ] Cases 4–7 pass (emit-once per path, idempotency, no-event-on-rollback).
- [ ] Cases 8–9 pass (transactional outbox correctness).
- [ ] Cases 10–12 pass (signing, retry/backoff/dead-letter/timeout, durable e2e delivery).
- [ ] Cases 13–15 pass (fail-closed secret, https enforcement, redaction).
- [ ] `nx test nestjs` and `nx e2e nestjs-e2e` are green in CI.

## References
- `libs/nestjs/src/lib/storage/object-writer.service.ts:219,344`; `domain/objects/object.service.ts:614`; `domain/multipart/multipart.service.ts:182`.
- `libs/nestjs/src/lib/common/background/trash-purge.runner.ts`, `background.service.ts:88`, `common/clock/clock.ts`.
- `libs/nestjs/src/lib/open-bucket-options.ts:174`, `common/config/env.schema.ts:29`, `open-bucket-core.module.ts:70`.
- `libs/nestjs/src/lib/common/faultpoint.ts` (forced-rollback fault injection for cases 7/9).
</content>
