---
slug: admin-console-tour
title: "What's in the box: a tour of the OpenBucket admin console"
description: A walkthrough of the admin console that ships inside OpenBucket — dashboard, object browser, search, config editors, keys, users, backups, and audit log.
authors: [openbucket]
tags: [admin-console, s3, self-hosted, object-storage, web-ui]
date: 2026-09-30
draft: true
keywords:
  [
    s3 admin ui self-hosted,
    minio console alternative,
    object storage web ui,
    s3 bucket browser,
    self-hosted s3 gui,
    s3 compatible admin console,
  ]
---

Most self-hosted object stores treat the web UI as an afterthought: a thin bucket
list bolted on later, a separate container to deploy, or a "community" console
that lags three versions behind the server. You end up doing real administration
with `aws s3api` and a prayer.

OpenBucket takes the opposite bet. The Angular admin console ships **inside the
same npm package and container as the store itself** — no second deployment, no
version skew, nothing extra to run. Set `serveUi: true` and it's there, whether
you run OpenBucket standalone via Docker or embedded under a path prefix in your
own NestJS app. This post is the tour: every screen, in the order you'll actually
use them.

<!-- truncate -->

## Zero extra deployment

Before the tour, the part that shapes everything else: the console is served as
static assets by the store, under your mount path.

```text
Standalone:  http://localhost:9000/admin
Embedded:    http://<host><mountPath>/admin     (e.g. /storage/admin)
```

The same build works identically in both modes, and it's an opt-in: configure the
`admin` block with `serveUi: true` and the console is wired; leave `admin` out
entirely and you get a headless, S3-only store with no admin surface at all. The
details live in the [NestJS module reference](/docs/reference/nestjs-module).
Behind login (argon2id passwords, rotating JWTs), every feature screen is
lazy-loaded, so first paint stays fast.

## The dashboard

Sign in and you land on an at-a-glance overview: total buckets, objects, and
stored bytes, your most recent buckets, and quick actions.

![OpenBucket admin dashboard](/img/admin_dashboard.png)

Below the headline numbers sit the **usage-analytics charts** — storage over
time, a per-bucket size breakdown, and request/error rates — fed by a background
rollup with bounded retention. The page polls on a bounded interval and pauses
while the tab is hidden, so it stays live without hammering your server.

## Buckets and the object browser

**Buckets** lists every bucket with object count, size, versioning, and lock
status. The **object browser** inside each bucket lists with a `/` delimiter, so
shared prefixes surface as folders you can walk into. From there:

- **Upload** files by drag-and-drop or picker, and **download** them back.
- **Preview** objects inline — images, PDFs, text and code, video, and audio —
  rendered in a sandboxed frame (CSP-locked, with per-kind size caps), so a
  hostile upload can't script its way out of the preview pane.
- **Share** an object with a presigned link that expires.
- **Delete** objects; on a versioned bucket you can inspect versions and delete
  markers instead of just the latest.

Rows are keyboard-operable, so you can drive the whole browser without a mouse.

## Cross-bucket search

Once you have more than a handful of buckets, "which bucket was that in again?"
becomes a daily question. **Search** answers it across *every* bucket at once:
pick `prefix` or `contains` mode, optionally filter by bucket or tag, and each
hit deep-links straight to that object's folder in the browser. The query box is
debounced and results page via a keyset cursor, so it stays snappy on large
stores.

## Per-bucket configuration editors

The bucket detail page is a tabbed editor for everything you'd otherwise script
against the S3 API:

- **Versioning** — enable or suspend.
- **Encryption** — toggle SSE-S3 at-rest encryption (AES-256).
- **Object Lock** — governance/compliance retention and legal hold.
- **Lifecycle** — expiration and transition (tiering) rules.
- **CORS** — the cross-origin rule editor.
- **Policy** — the bucket policy JSON editor.
- **Tags** and **Properties** round it out.

These aren't read-only status pages; they're the actual write path for bucket
config, which matters when you're debugging a CORS rule at 11 pm and don't want
to hand-craft XML.

## Settings: keys, users, backups, and more

Everything instance-level is consolidated into one tabbed **Settings** page —
and because the active tab is a `?tab=` query param, you can bookmark or link a
specific tab.

![Settings](/img/admin_settings.png)

**Access Keys.** Create, inspect, rotate, and revoke keys — including **scoped
sub-keys** confined to a bucket or prefix, which is how you hand a tenant or a
CI job credentials that can't touch anything else. The secret is shown once on
creation, and scoped keys get an effective-permissions allow/deny view plus a
single-action simulator so you can check "can this key do X?" before it ships.

**Admin Users.** Multiple admin accounts, each either a **full admin** or
**read-only** (signs in, sees everything, gets a `403` on any change). Guardrails
are built in: you can't delete or demote the last full admin, and you can't
delete your own account.

**Backup & Restore.** Whole-instance or per-bucket `.zip` snapshots, on demand
or on a **schedule** (cron or interval) with retention. Restore resets the
target, so the console demands explicit confirmation first. More in the
[backup & restore guide](/docs/guides/backup-and-restore).

**Replication.** If you mirror to an external S3-compatible target, this tab
shows outbox depth and lag, plus a **Reconcile** action that diffs local objects
against the remote and re-enqueues anything missing.

**Integrity.** The background scrubber that re-hashes blobs against their stored
SHA-256 reports here: scanned/ok/corrupt/repaired stat cards, a corrupt-object
table, and a **Scrub now** button. When anything is corrupt, a red badge appears
in the sidebar — hidden at zero, so it only speaks up when it matters.

**Audit Log.** A durable, queryable record of every state-changing admin action,
newest first, keyset-paged with bounded retention. Not a tail of stdout — it's
persisted and searchable from the console.

## The quality-of-life layer

Small things that add up: the console is localized in **English and German**,
supports **light/dark/system** themes with a color-scheme picker, and lets you
change your password without leaving the Appearance tab.

## The honest caveats

OpenBucket is pre-1.0. The S3 surface and the console are feature-complete and
tested, but APIs may still shift before 1.0, and the store is single-node by
design — if you need a distributed cluster, this isn't it, and the
[Is OpenBucket for you?](/docs/is-openbucket-for-you) guide says so plainly.
Coming from MinIO and wondering how the consoles compare? There's an honest
[comparison](/docs/comparisons/vs-minio) for that too.

## Try it in two minutes

The fastest way to see all of this is the
[Docker quickstart](/docs/getting-started/quickstart-docker) — one container,
console included at `/admin`. The full
[admin console guide](/docs/guides/admin-console) covers every screen in more
depth.

---

If a bundled console is the thing you've been missing from self-hosted object
storage, consider dropping a ⭐ on
[GitHub](https://github.com/ProjectBay/openbucket) — it's the main way new
people discover the project. And if there's a screen you wish existed, tell us
in [Discussions](https://github.com/ProjectBay/openbucket/discussions); the
roadmap is genuinely shaped there.
