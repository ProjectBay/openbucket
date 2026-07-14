---
slug: object-events-and-signed-webhooks
title: 'Reacting to uploads: in-process object events and signed webhooks'
description: Run code the moment a file lands in your self-hosted S3 store — @OnObjectCreated handlers in-process, or signed webhooks you actually verify.
authors: [openbucket]
tags: [nestjs, webhooks, events, s3, self-hosted, tutorial]
date: 2026-09-09
draft: true
keywords:
  [
    s3 event notifications self-hosted,
    nestjs object storage events,
    webhook signature verification nodejs,
    s3 object created event,
    hmac webhook verification node,
    transactional outbox webhooks,
  ]
---

An upload is rarely the end of the story. The moment a file lands you usually want
something to happen next: generate a thumbnail, index a document, kick off a virus
scan, ping another service. On AWS that's S3 Event Notifications plus SNS or
Lambda; self-hosted, you're often left polling a bucket on a cron.

OpenBucket ships both halves of the answer. If your code runs **in the same NestJS
process** as the store, a decorator gives you the event with zero configuration. If
the consumer is a **separate service**, signed HTTP webhooks deliver the same event
durably. In this post we'll build one feature — thumbnails for every uploaded
image — both ways, including the part most webhook tutorials skip: actually
verifying the signature on the receiving end.

<!-- truncate -->

## The event, first

Both delivery paths carry the same flat, JSON-serializable `ObjectEvent`:

```ts title="ObjectEvent (from @openbucket/nestjs)"
interface ObjectEvent {
  type: 'object.created' | 'object.deleted' | 'multipart.completed';
  bucket: string;
  key: string;
  size: number; // bytes; 0 for a delete / delete-marker
  etag: string; // object ETag; '' for a delete-marker
  versionId?: string; // present only on versioning-enabled buckets
  eventTime: string; // ISO-8601
}
```

Three event types exist today, and only three: `object.created` (a committed
`PutObject` / `CopyObject` / admin write), `object.deleted` (a delete or
delete-marker), and `multipart.completed` (a committed
`CompleteMultipartUpload`). Every field comes from the already-committed row —
no request headers, IPs, or credentials are ever included. Note there's no
content type in the event; if you need it, fetch it with `headObject`.

## Act 1 — In-process: `@OnObjectCreated()`

If OpenBucket is embedded in your NestJS app, you don't need HTTP at all.
Decorate a provider method and it runs in your process whenever an object
commits:

```ts title="thumbnail.listener.ts"
import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  OnObjectCreated,
  OpenBucketService,
  type ObjectEvent,
} from '@openbucket/nestjs';

@Injectable()
export class ThumbnailListener {
  private readonly log = new Logger(ThumbnailListener.name);

  constructor(private readonly ob: OpenBucketService) {}

  @OnObjectCreated()
  async onCreated(event: ObjectEvent) {
    // Only react to the uploads bucket — writing the thumbnail below fires
    // another object.created, and this guard is what breaks the loop.
    if (event.bucket !== 'uploads') return;

    const head = await this.ob.headObject(event.bucket, event.key);
    if (!head?.contentType?.startsWith('image/')) return;

    const original = await this.ob.getObjectBuffer(event.bucket, event.key);
    const thumb = await sharp(original).resize(320, 320, { fit: 'inside' }).webp().toBuffer();

    await this.ob.putObject('thumbnails', `${event.key}.webp`, thumb, {
      contentType: 'image/webp',
    });
    this.log.log(`thumbnail ready for ${event.bucket}/${event.key}`);
  }
}
```

Register `ThumbnailListener` as a provider and you're done. Two companion
decorators cover the other events: `@OnObjectDeleted()` (perfect for cleaning up
the matching thumbnail) and `@OnMultipartCompleted()`.

Now the honest part. In-process handlers are dispatched **fire-and-forget** —
OpenBucket never awaits them, so a handler that throws or hangs can't stall or
fail the upload. The flip side: a handler failure is **logged and dropped, not
retried**, and if your process crashes between the commit and your handler
running, that event is gone. For anything you can't afford to lose, treat the
handler as a cheap trigger — enqueue a job in BullMQ or your queue of choice —
or use webhooks, which brings us to Act 2.

## Act 2 — Standalone: signed HTTP webhooks

Suppose thumbnail generation lives in a separate media service (or OpenBucket
runs as the [standalone Docker container](/docs/getting-started/quickstart-docker)
with no host app at all). Point OpenBucket at a URL:

```ts title="app.module.ts (embedded)"
OpenBucketModule.forRoot({
  // …
  webhooks: {
    url: 'https://media.internal.example.com/hooks/openbucket',
    secret: process.env.OB_WEBHOOK_SECRET!, // ≥ 32 chars, validated at boot
    events: ['object.created'], // optional filter; default: all three
  },
});
```

Standalone, the same thing is env-driven: `WEBHOOK_URL`, `WEBHOOK_SECRET`, and
an optional `WEBHOOK_EVENTS` CSV. Webhooks are **off** unless a URL is set, and
the config is fail-closed: the URL must be `https` (or a loopback host) and the
secret at least 32 characters, or the app refuses to boot.

Delivery is built on a **transactional outbox**: each matching event persists a
row in the *same transaction* that commits the object, so the notification
commits atomically with the write — or not at all. A background runner drains
the outbox and POSTs each event:

```text title="What your endpoint receives"
POST /hooks/openbucket
Content-Type: application/json
User-Agent: openbucket-webhooks/<version>
X-OpenBucket-Event: object.created
X-OpenBucket-Delivery: <uuid>
X-OpenBucket-Signature: t=<unix>,v1=<hex-hmac>

{"type":"object.created","bucket":"uploads","key":"2026/ab….jpg","size":12345,"etag":"…","eventTime":"2026-09-09T12:00:00.000Z"}
```

Only a `2xx` counts as success. Failures (non-`2xx`, network error, timeout —
and any `3xx`, since redirects are deliberately not followed) retry with
full-jitter exponential backoff, base 2 s, capped at 1 hour. After
`maxAttempts` (default 8) the row is dead-lettered and no longer retried;
terminal rows are pruned after 7 days. Delivery is **at-least-once** and
ordering is best-effort due-time order, not strictly per-key — plan for both.

### Verify the signature (don't skip this)

An unverified webhook endpoint is an unauthenticated API: anyone who finds the
URL can feed your media service fake "objects". The
`X-OpenBucket-Signature` header is `t=<unix>,v1=<hex>`, where the HMAC-SHA256
covers `` `${timestamp}.${rawBody}` `` — the same Stripe-style scheme you may
already know. Verification needs the **raw** request bytes (parsing and
re-serializing the JSON changes them and breaks the signature), a
**constant-time** compare, and a staleness check against replay:

```ts title="media-service: receiver with verification (Express)"
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.OB_WEBHOOK_SECRET!;

function verify(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts['t']);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false; // 5-min window
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts['v1'] ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = express();

// express.raw, NOT express.json — the signature covers the unparsed bytes.
app.post('/hooks/openbucket', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  const sig = req.header('X-OpenBucket-Signature') ?? '';
  if (!verify(raw, sig, SECRET)) return res.status(401).end();

  const deliveryId = req.header('X-OpenBucket-Delivery')!;
  const event = JSON.parse(raw);
  // At-least-once delivery → dedupe on deliveryId, then enqueue the thumbnail job.
  enqueueThumbnailJob(deliveryId, event);

  res.status(204).end(); // respond fast; do the work async
});
```

Two receiver rules worth tattooing somewhere: **dedupe on
`X-OpenBucket-Delivery`** (a crash after your `2xx` but before the row is marked
delivered will re-send), and **return `2xx` quickly** — do the actual resizing
off the request path so a slow `sharp` call doesn't eat into the 5-second
delivery timeout and trigger a pointless retry.

## Choosing between the two

Same event, two contracts:

| | In-process handlers | Signed webhooks |
| --- | --- | --- |
| Runs | Same Node process | Any external HTTPS URL |
| Setup | Register a provider | `webhooks.url` + secret |
| Delivery | Fire-and-forget, no retry | Durable outbox, at-least-once, retried |
| Failure mode | Logged and dropped | Backoff → dead-letter after `maxAttempts` |

A reasonable default: reach for the **in-process handler** when the work is
cheap, local, and tolerable to lose in a crash — or when it just enqueues into a
queue you already trust. Reach for **webhooks** when the consumer is another
service, or when "we never got the event" is not an acceptable bug report. And
they're not exclusive: run both, one for local jobs and one to notify the
outside world.

The full option list and edge cases live in the
[events and webhooks guide](/docs/guides/events-and-webhooks), the upload paths
that fire `object.created` are covered in [file uploads](/docs/guides/file-uploads),
and every `webhooks.*` knob is in the
[NestJS module reference](/docs/reference/nestjs-module).

---

OpenBucket is pre-1.0 and built in the open — if signed, self-hosted S3 event
notifications are something you've been missing, a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) tells us to keep going. Found
a sharp edge in the webhook contract, or want an event we don't emit yet? Open a
thread in [Discussions](https://github.com/ProjectBay/openbucket/discussions).
