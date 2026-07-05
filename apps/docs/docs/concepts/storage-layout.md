---
title: Storage layout
description: Exactly what OpenBucket writes into DATA_DIR — the SQLite metadata DB, the blob tree, the key-to-path encoding, and the tmp/trash/multipart working dirs.
sidebar_position: 4
---

# Storage layout

**What you'll learn:** everything OpenBucket writes under `DATA_DIR`, so you know
what to back up, what's safe to delete, and how an S3 key maps to a file on disk.

## The `DATA_DIR` tree

Point OpenBucket at one directory and it owns the whole tree beneath it:

```text
DATA_DIR/
├── openbucket.db            SQLite metadata (buckets, objects, versions, keys, audit…)
├── openbucket.db-wal        SQLite write-ahead log  (WAL mode)
├── openbucket.db-shm        SQLite shared-memory index (WAL mode)
├── sse.key                  the 32-byte SSE-S3 key, mode 0600 (generated on first boot)
├── blobs/                   object payloads, one file per object
│   └── <bucket>/
│       ├── <encoded-key>            the current object blob
│       └── <encoded-key>.v/         version blobs (when versioning is on)
│           └── <versionId>
├── multipart/               in-progress multipart uploads
│   └── <uploadId>/
│       └── <N>.part                 one staged part per part number
├── tmp/                     staging for atomic writes (put-<uuid>, compose-<uuid>)
├── trash/                   soft-deleted blobs awaiting purge
│   ├── <entryId>                    the moved-aside blob
│   └── <entryId>.manifest.json      what it was (bucket, key, deletedAt)
├── derivatives/             cached image-transform outputs (content-addressed)
│   └── <ab>/<hash>.<ext>            fanned out by the first 2 hex chars of the hash
└── backups/                 scheduled .zip snapshots (default location)
```

:::tip[Back up the whole directory]
`DATA_DIR` is the entire state of the instance — metadata **and** bytes. A
filesystem-level snapshot of it (with the process stopped, or via the built-in
backup) is a complete point-in-time copy. Don't try to back up `blobs/` without
`openbucket.db`: the database is the source of truth for which blobs are live.
:::

## Metadata: one SQLite file

All metadata — buckets, object rows, versions, access keys, audit events, usage
samples, the replication outbox — lives in **`openbucket.db`**, opened in **WAL
mode** with `synchronous = FULL` and foreign keys on. WAL mode means you'll also
see `openbucket.db-wal` and `openbucket.db-shm` alongside it; all three belong
together. The hot read path (listing, HEAD, resolving a key to a blob) reads keys
from SQLite, never by scanning the disk.

## Blobs: one file per object

An object's bytes live at `blobs/<bucket>/<encoded-key>`. The filename is the S3
key run through a **filesystem-safe encoding** (see below), and `/` in the key is
preserved as a real directory separator — so `photos/2026/cat.jpg` becomes nested
directories on disk, mirroring the S3 "folder" convention.

When versioning is enabled, prior versions live in a sibling directory named by
appending `.v` to the object's blob path, with one file per `versionId`.

## The key-codec: S3 keys → filenames

S3 keys allow almost any byte; filesystems don't. `key-codec.ts` bridges them with
a percent-encoding scheme applied **per path segment** (the pieces between `/`):

- **Pass-through** unchanged: `A–Z`, `a–z`, `0–9`, and `- _ . ~`.
- **Preserved** as a separator: `/` (so keys form directory trees).
- **Percent-encoded** byte-wise as `%XX` (UTF-8): everything else.

Plus a few safety fixups per segment:

- A **leading `.`** becomes `%2E` (so a key doesn't create a Unix hidden file).
- A **trailing `.`** or **trailing space** is encoded (Windows can't host those
  filenames — the encoding stays forward-compatible even though production is Linux).
- An **empty segment** (from a trailing slash like `photos/`, or a `//` in the
  key) becomes the placeholder `%2F`, so the path never ends in or doubles a `/`.
- A segment whose encoded form exceeds **255 bytes** throws `KeyTooLongError`.

The encoding round-trips: `decodeKey` reverses it. Decoding is only used for
diagnostics and the orphan-blob recovery scan — the hot path always reads the raw
key from SQLite.

:::note[Why not just base64 the key?]
The path-mirroring encoding keeps the on-disk tree **human-legible** and preserves
the folder structure, so an operator browsing `blobs/` sees something close to the
logical layout — while still being safe against traversal, hidden files, and
oversized names.
:::

## Working directories

- **`tmp/`** — staging for the atomic write path. Every blob is written here first
  (`put-<uuid>`, `compose-<uuid>`), fsync'd, then renamed into `blobs/`. Files
  here are transient; a crash may leave strays that are safe to sweep.
- **`multipart/<uploadId>/`** — staged parts (`<N>.part`) for an in-progress
  multipart upload. On `CompleteMultipartUpload` the parts are composed into a
  single blob; the startup recovery scan removes staging dirs whose `uploadId` is
  no longer in the database.
- **`trash/`** — a delete is a **soft delete**: the blob is moved here as
  `<entryId>` with an `<entryId>.manifest.json` recording where it came from, and
  a background purge tick unlinks it later. This is what lets tiering soft-delete a
  local blob recoverably during the grace window.
- **`derivatives/`** — the content-addressed cache of on-the-fly image transforms,
  fanned out by the first two hex characters of the derivative's hash to avoid one
  mega-directory. The hash is server-produced, so there's no user-controlled path
  segment here. An LRU GC tick evicts past `DERIVATIVE_CACHE_MAX_BYTES`.

## `sse.key`

When `OPENBUCKET_SSE_KEY` is unset, OpenBucket generates a random 32-byte SSE-S3
key on first boot and persists it to `<DATA_DIR>/sse.key` (mode `0600`). Each
encrypted object stores its own random IV in metadata; the key is instance-wide.

:::warning[`sse.key` is break-glass material]
Losing this file makes every SSE-encrypted object permanently unreadable. Back it
up with your other secrets — and prefer delivering it via `OPENBUCKET_SSE_KEY`
from a secrets manager over relying on the generated file. See the
[security model](./security-model.md#at-rest-object-encryption-sse-s3).
:::

## Next steps

- [Durability](./durability.md) — the atomic write path and integrity gates that produce this layout.
- [Deployment](../operations/deployment.md) — mounting `DATA_DIR` as a Docker/k8s volume.
- [Security model](./security-model.md) — what's sensitive on disk and how it's protected.
- [Configuration reference](../reference/nestjs-module.md) — `DATA_DIR` and related options.
