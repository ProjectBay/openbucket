---
id: STORY-0801
title: Object event notifications (in-process events + webhooks)
epic: EPIC-09
status: backlog
size: L
risk: medium
---

## User story
As an app developer embedding `@openbucket/nestjs`, I want a typed in-process event every time an object is created, deleted, or a multipart upload completes — and, in the standalone image, an optional signed HTTP webhook with durable at-least-once delivery — so that I can react to uploads (thumbnailing, virus scan, DB row insert, cache invalidation) inside my host process without polling, and so that a standalone deployment can notify an external system reliably even across restarts.

## Description
Emit three typed events — `object.created`, `object.deleted`, `multipart.completed` — at the storage-layer commit boundary so BOTH the S3 wire path and the admin/library write paths are covered by a single choke point. In-process delivery uses `@nestjs/event-emitter` wrapped in an injectable `ObjectEventsService`, with `@OnObjectCreated()` / `@OnObjectDeleted()` / `@OnMultipartCompleted()` handler decorators the host app registers — the unique embedding advantage hosted S3/MinIO structurally cannot offer. For the standalone image, a transactional outbox (`event_deliveries` table in the same libsql DB) plus a `WebhookDeliveryRunner` background tick POST the signed JSON payload to a configured URL with HMAC signing, exponential backoff, bounded retries, and a dead-letter state — giving durable at-least-once delivery. The event payload carries `{ type, bucket, key, size, etag, versionId, eventTime }`.

## Acceptance criteria
- [ ] A host NestJS app that declares a provider method annotated `@OnObjectCreated()` receives a typed `ObjectEvent` for every stored object, whether written via S3 `PutObject`, S3 `CopyObject`, or the admin/library `OpenBucketService.putObject`.
- [ ] `@OnObjectDeleted()` fires for S3 `DeleteObject`, S3 bulk `DeleteObjects`, and admin object delete; `@OnMultipartCompleted()` fires on `CompleteMultipartUpload`.
- [ ] The event payload is exactly `{ type, bucket, key, size, etag, versionId?, eventTime }` with `eventTime` an ISO-8601 string and `versionId` present only on versioning-enabled buckets.
- [ ] A throwing in-process handler is isolated: it logs an error but never fails or delays the originating write (the PUT/DELETE still returns its normal status).
- [ ] Events are emitted only AFTER the DB transaction commits, so no event is delivered for a write that rolled back (F2/F3 no-op-on-failure discipline is preserved).
- [ ] With `webhooks.url` + `webhooks.secret` configured, each event enqueues a durable `event_deliveries` row inside the same transaction as the object write; the row survives a process restart and is delivered by the background tick.
- [ ] The webhook POST carries `X-OpenBucket-Event`, `X-OpenBucket-Delivery`, and `X-OpenBucket-Signature: t=<unix>,v1=<hmac-sha256-hex>` over the exact raw body; a 2xx marks the row `delivered`, a non-2xx/timeout schedules a retry with exponential backoff + jitter, and after `maxAttempts` the row is marked `failed` (dead-letter).
- [ ] Webhooks are disabled by default; when `webhooks.url` is set without a valid `webhooks.secret` the module refuses to boot (mirrors `validateSecurityCriticalOptions`).
- [ ] The webhook secret is redacted from logs (added to the nestjs-pino `redact.paths`) and never appears in an audit or delivery-failure log line.
- [ ] `nx test nestjs` and `nx e2e nestjs-e2e` pass with the new suites; `nx build nestjs` type-checks the new public exports (`ObjectEvent`, the three decorators, `ObjectEventsService`).

## Tasks
- [TASK-2410] Define the object-event contract, `ObjectEventsService`, and the `@OnObjectCreated/@OnObjectDeleted/@OnMultipartCompleted` decorators
- [TASK-2411] Emit events at the write/delete commit choke points (writer + `deleteOne`)
- [TASK-2412] Add the durable webhook outbox entity, migration, and transactional enqueue
- [TASK-2413] Implement signed webhook delivery: `WebhookSigner` + `WebhookDeliveryRunner` (retry/backoff/dead-letter)
- [TASK-2414] Wire notification config through options, env schema, `AppConfigService`, and log redaction

## Test plan
- [TEST-0801] Object events and signed-webhook delivery

## Dependencies
- Blocks: [STORY-0803] (the DX helpers reference the event hooks in the rewritten upload recipe).
- Blocked by: _none_ — builds on the existing two-phase writer (`ObjectWriterService.put`/`putComposed`, STORY-0302/0306), `ObjectService.deleteOne` (STORY-0108), and the background tick (`BackgroundService`, §4.9).
- Reuses EPIC-08 posture (must NOT regress): writes reaching the emit points are already authorized by `s3/authz/policy-authorization.guard` + `policy-evaluator`; `strongSecret()` from `common/config/env.schema.ts` validates the webhook secret; the nestjs-pino `redact` list in `open-bucket-core.module.ts` hides it; the background tick's no-pile-up guarantee bounds delivery-tick concurrency; object keys are already length/charset-bounded by `storage/key-codec.ts`.

## References
- `libs/nestjs/src/lib/storage/object-writer.service.ts` (`put()` line 105, `putComposed()` line 255 — the shared commit boundary for S3 + admin + copy + multipart).
- `libs/nestjs/src/lib/domain/objects/object.service.ts` (`deleteOne()` line 614 — shared delete seam), `putObject` line 253, `putFromStream` line 286, `copyObject` line 350.
- `libs/nestjs/src/lib/domain/multipart/multipart.service.ts` (`completeUpload()` line 182).
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` (existing structured-event pattern to mirror).
- `libs/nestjs/src/lib/common/background/background.service.ts` (`ScheduledTask`, `SCHEDULED_TASKS`), `background.module.ts`, `trash-purge.runner.ts` (runner exemplar).
- `libs/nestjs/src/lib/open-bucket-options.ts` (`OpenBucketModuleOptions`, `resolveOptions`, `validateSecurityCriticalOptions`), `common/config/env.schema.ts` (`strongSecret`), `common/config/app-config.service.ts`, `common/config/config-source.ts`.
- `libs/nestjs/src/lib/persistence/index.ts`, `mikro-orm.config.ts`, `persistence/entities/refresh-token.entity.ts` (entity + index exemplar), `migrations/Migration20260701000001_object_content_sha256.ts` (migration exemplar).
- Interfaces consumed: `ObjectWriterService`, `ObjectService.deleteOne`, `BackgroundService`/`ScheduledTask`, `AppConfigService`, `EntityManager`.
- Interfaces produced: `ObjectEvent`, `ObjectEventsService`, `@OnObjectCreated`/`@OnObjectDeleted`/`@OnMultipartCompleted`, `EventDeliveryEntity`, `WebhookSigner`, `WebhookDeliveryRunner`.
- New dependency: `@nestjs/event-emitter` (^3). No new HTTP client — Node global `fetch` + `AbortController` for the per-delivery timeout. (`sharp` / `@aws-sdk/client-s3` are NOT used by this Story — they belong to [STORY-0800] / test tooling.)
</content>
</invoke>
