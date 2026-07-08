---
title: Upgrading
description: Move OpenBucket between versions safely — pre-1.0 expectations, forward-only migrations that run on boot, backing up first, and the Docker tag and npm dist-tag to pull.
sidebar_position: 3
---

# Upgrading

**What you'll do:** upgrade an OpenBucket instance without losing data — back up,
pull the new version, and let it migrate itself on boot.

## The short version

```bash
# 1. Take a snapshot FIRST (see "Back up before you upgrade" below).
openbucket backup create -o pre-upgrade.zip

# 2. Pull the new image and restart. Migrations run automatically on boot.
docker compose pull
docker compose up -d

# 3. Confirm it's healthy and on the version you expect.
curl -s http://localhost:9000/api/admin/health
```

That's the whole flow: snapshot, pull, restart. OpenBucket runs its own database
migrations on startup, so there is no separate migrate step.

## Pre-1.0 versioning

OpenBucket is **pre-1.0 and under active development**. The S3 surface and admin
console are feature-complete and tested, but **APIs and options may still change
before 1.0** — treat minor version bumps as potentially breaking and read the
release notes.

Two independently-versioned artifacts ship from the one codebase:

- **The standalone server image** — tagged `ghcr.io/<owner>/openbucket:<version>`
  on each `v*` release (plus `:{major}.{minor}` and `:latest`).
- **The embeddable library** — `@openbucket/nestjs` on npm, currently on
  pre-release versions.

:::tip[Pin exact versions in production]
Deploy a pinned tag (`ghcr.io/<owner>/openbucket:0.1.0` or an exact npm version),
not `:latest`/`next`. Pinning makes an upgrade a deliberate, reviewable change and
keeps two environments reproducibly identical.
:::

## Migrations run forward-only, on boot

OpenBucket applies its database migrations **automatically during module init** —
before the HTTP listener binds and before any DB-querying startup work (admin
seeding, the recovery scan). You don't run a migration command; a fresh image just
migrates the existing `openbucket.db` up to its schema on first start.

Migrations are **forward-only** and **all-or-nothing** (each runs in a
transaction). There is no built-in down-migration path, which is the other reason
to snapshot before upgrading: **rolling back means restoring the pre-upgrade
snapshot**, not reversing a migration. Applied migrations are logged
(`Applied N migration(s) on init`).

:::warning[Don't downgrade the image against an upgraded database]
Once a newer version has migrated `openbucket.db` forward, an **older** image may
not understand the new schema. If you need to go back, restore the snapshot you
took before the upgrade rather than pointing an old binary at a new database.
:::

## Back up before you upgrade

Always capture a point-in-time copy of the full state **before** pulling a new
version. Any one of these works:

- **The built-in backup** — `openbucket backup create -o pre-upgrade.zip` (a
  whole-instance `.zip`), or a
  [scheduled snapshot](../concepts/durability.md#backups-point-in-time-snapshots)
  you know is recent.
- **A filesystem snapshot** of `DATA_DIR` with the process stopped — the SQLite DB
  and blob tree must be captured together (see [storage layout](../concepts/storage-layout.md)).

If an upgrade goes wrong, restore the snapshot onto the previous version:

```bash
openbucket backup restore -f pre-upgrade.zip --yes   # destructive — resets the target
```

## Upgrading the standalone image

```bash
# docker-compose: pull the pinned tag you set in the compose file, then restart.
docker compose pull
docker compose up -d
```

With `restart: unless-stopped` and `app.enableShutdownHooks()` (built into the
image), a restart drains in-flight requests on `SIGTERM` within `SHUTDOWN_DRAIN_MS`
before the new container takes over. After it's up, confirm the running build via
the JWT-guarded `GET /api/admin/version` (or the console's About view) and watch
the [health probes](./monitoring.md#health-and-readiness-probes).

## Upgrading the embedded library

Because pre-release versions publish to the **`next`** dist-tag (stable releases
go to `latest`), a plain install keeps resolving to the latest **stable** release
— so to move to a pre-release you ask for it explicitly:

```bash
# Latest stable (the default):
npm install @openbucket/nestjs

# Latest pre-release (the `next` dist-tag):
npm install @openbucket/nestjs@next

# A specific version (recommended for reproducible deploys):
npm install @openbucket/nestjs@0.1.0-alpha.18
```

Migrations still run automatically when your host app boots (`OpenBucketModule`
applies them on init) — no external migrate call is needed. Snapshot first here
too: the same forward-only, restore-to-roll-back rule applies.

## Next steps

- [Deployment](./deployment.md) — the base install this upgrades.
- [Durability](../concepts/durability.md) — scheduled backups you can lean on for the pre-upgrade snapshot.
- [Monitoring](./monitoring.md) — verify health and version after the upgrade.
- [Configuration reference](../reference/nestjs-module.md) — new options a version may introduce.
