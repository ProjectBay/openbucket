---
title: Events and webhooks
description: React to object writes and deletes — in-process @OnObjectCreated handlers for embedders, and signed HTTP webhooks for external services.
sidebar_position: 3
---

# Events and webhooks

Run code the moment an object lands, is deleted, or a multipart upload completes. There are two delivery paths: **in-process handlers** (same Node process, zero config) and **signed HTTP webhooks** (durable, to an external URL).

## In-process: `@OnObjectCreated()`

Decorate any provider method. It receives the event and runs in your process, in-process — no HTTP, no signing.

```ts
import { Injectable } from '@nestjs/common';
import { OnObjectCreated, type ObjectEvent } from '@openbucket/nestjs';

@Injectable()
export class ThumbnailListener {
  @OnObjectCreated()
  async onCreated(event: ObjectEvent) {
    console.log(`new object: ${event.bucket}/${event.key} (${event.size} bytes)`);
    // enqueue a thumbnail job, index the object, update a counter…
  }
}
```

Register the listener class as a provider in your module and you're done. Three decorators are exported from `@openbucket/nestjs`:

| Decorator | Fires after a committed… |
| --- | --- |
| `@OnObjectCreated()` | `PutObject` / `CopyObject` / admin write |
| `@OnObjectDeleted()` | `DeleteObject` / bulk delete / delete-marker |
| `@OnMultipartCompleted()` | `CompleteMultipartUpload` |

:::warning In-process handlers run with your app's full privileges
OpenBucket does **not** sandbox these — they are your code. They are dispatched fire-and-forget (never awaited), so a handler that throws or hangs can't stall or fail the write. But that also means a handler failure is logged and dropped, not retried. For guaranteed delivery, use webhooks.
:::

## The event shape

Both paths carry the same flat, JSON-serializable `ObjectEvent`:

```ts
interface ObjectEvent {
  type: 'object.created' | 'object.deleted' | 'multipart.completed';
  bucket: string;
  key: string;
  size: number;      // bytes; 0 for a delete / delete-marker
  etag: string;      // object ETag; '' for a delete-marker
  versionId?: string; // present only on versioning-enabled buckets
  eventTime: string; // ISO-8601
}
```

Every field comes from the already-committed row — no request headers, IPs, or credentials are ever included.

## Signed HTTP webhooks

Point OpenBucket at an HTTPS URL and every matching event is POSTed to it, signed, with durable at-least-once delivery. Configure it in the module options:

```ts
OpenBucketModule.forRoot({
  // …
  webhooks: {
    url: 'https://hooks.example.com/openbucket',
    secret: process.env.OB_WEBHOOK_SECRET!, // ≥ 32 chars, validated at boot
    events: ['object.created', 'object.deleted'], // optional filter; default: all three
    maxAttempts: 8,   // default 8
    timeoutMs: 5000,  // default 5000
    pollMs: 15000,    // default 15000
  },
});
```

Standalone (env-driven) equivalents:

```bash
WEBHOOK_URL=https://hooks.example.com/openbucket
WEBHOOK_SECRET=a-strong-secret-at-least-32-characters
WEBHOOK_EVENTS=object.created,object.deleted   # CSV; default all three
WEBHOOK_MAX_ATTEMPTS=8
WEBHOOK_TIMEOUT_MS=5000
WEBHOOK_POLL_MS=15000
```

Webhooks are **off** unless a `url` (or `WEBHOOK_URL`) is set. When present, the outbox and the delivery runner turn on; in-process handlers keep working either way.

:::note Config is fail-closed at boot
The URL must be `https` (or a loopback host), and the secret must be at least 32 characters, or the app refuses to boot. This is deliberate — no weak-secret or plaintext webhook can slip into production.
:::

### How delivery works

Each matching event persists a durable row in the **same transaction** that commits the object (a transactional outbox), so the notification is never lost — it commits atomically with the write, or not at all. A background runner drains the outbox and POSTs each event.

The request:

```
POST https://hooks.example.com/openbucket
Content-Type: application/json
User-Agent: openbucket-webhooks/<version>
X-OpenBucket-Event: object.created
X-OpenBucket-Delivery: <uuid>
X-OpenBucket-Signature: t=<unix>,v1=<hex-hmac>

{"type":"object.created","bucket":"uploads","key":"2026/ab….jpg","size":12345,"etag":"…","eventTime":"2026-07-05T12:00:00.000Z"}
```

The body is exactly `JSON.stringify(event)` — the same bytes the signature covers. Only a `2xx` response counts as success.

### Verifying the signature (HMAC)

The `X-OpenBucket-Signature` header is `t=<unix>,v1=<hex>`, where the HMAC-SHA256 covers `` `${timestamp}.${rawBody}` `` (Stripe-style). Verify it with a **constant-time** compare against the **raw** request body, and reject stale timestamps to defend against replay:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts['t']);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false; // 5-min window
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts['v1'] ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

:::warning Sign the raw body, and dedupe on the delivery id
Compute the HMAC over the **unparsed** request bytes — re-serializing the JSON will change the bytes and break the signature. Because delivery is **at-least-once** (a crash after your `2xx` but before the row is marked delivered re-sends), your receiver must be idempotent: dedupe on the `X-OpenBucket-Delivery` id.
:::

### Retries and dead-lettering

A non-`2xx` response, a network error, or a timeout is retried with full-jitter exponential backoff (base 2s, capped at 1h). After `maxAttempts` the row is dead-lettered to a `failed` state and no longer retried. Terminal rows (delivered or failed) are pruned after 7 days. Events are processed in due-time order — **best-effort, not strictly per-key** — so don't rely on strict ordering.

:::info SSRF-safe by construction
The webhook URL is operator-configured (never tenant-controlled) and validated `https`/loopback at config time. Redirects are **not** followed — any `3xx` is treated as a failure. The response body is discarded (only the status matters), and the signing secret is never logged.
:::

## In-process vs. webhooks

| | In-process handlers | HTTP webhooks |
| --- | --- | --- |
| Target | Same Node process | Any external HTTPS URL |
| Setup | Register a provider | Set `webhooks.url` + secret |
| Delivery | Fire-and-forget, no retry | Durable, at-least-once, retried |
| Best for | Enqueueing jobs, indexing, counters | Notifying other services / systems |

They're not exclusive — run both. Use an in-process handler to enqueue local work, and a webhook to notify an external system.

## Next steps

- [File uploads](./file-uploads.md) — the writes that fire `object.created`.
- [Sharing files](./sharing-files.md) — hand out URLs to the objects you're notified about.
- [NestJS module reference](../reference/nestjs-module.md) — the full webhook option list.
