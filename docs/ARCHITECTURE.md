# OpenBucket — Architecture

> **Status:** planning. Decisions in §2 are settled; §11 lists open questions still needing answers. For implementation choices (libraries, module layout, testing), see [`BACKEND-DESIGN.md`](./BACKEND-DESIGN.md).

---

## 1. Goal

OpenBucket is a **single-container, single-process, self-contained S3-compatible object store** with a built-in admin UI.

The unit of deployment is **one Docker image**. No sidecars. No external database. No external cache. No external auth server. Pull, `docker run -v /host/data:/data -p 9000:9000 openbucket`, done.

What's in the image:

- **openbucket-backend** — a NestJS HTTP server that simultaneously
  - speaks the **S3 wire protocol** (path-style and virtual-host-style) on the same port,
  - serves a JSON **admin API**,
  - serves the **admin SPA** as static files.
- **openbucket-frontend** — the Angular admin app, pre-built into static assets and bundled into the backend's `dist/` so the same Node process serves it.
- **SQLite** — embedded, no separate daemon. Stores metadata only (buckets, objects, multipart sessions, lifecycle rules, access keys, sessions). Object payloads live on the filesystem.

Persistence is a **single host-mounted volume** (configurable via env var). Everything is restartable from that one directory.

---

## 2. Decisions locked in

| Area | Decision |
|---|---|
| Deployment unit | One Docker image, one process, one host-mounted volume. |
| S3 API scope | **MinIO parity** — bucket+object CRUD, multipart, presigned URLs, copy, CORS, versioning, lifecycle, object locking, server-side encryption, tagging, basic bucket policies. |
| Auth | **Single-tenant.** One admin user (username + password) for the UI. One pair of root access keys (`AccessKeyId` + `SecretAccessKey`) for the S3 protocol. Future: per-application sub-keys; root-only for v1. |
| Metadata store | Embedded SQLite. WAL mode. No external DB. |
| Object body storage | **Path-mirror** on the host filesystem: `<DATA_DIR>/blobs/<bucket>/<key>`. Directories created on demand. Unsafe key bytes percent-encoded (see §6). |
| Network surface | **Single HTTP port.** Path-routed: `/admin/*` → SPA, `/api/admin/*` → admin JSON API, everything else → S3 protocol. Virtual-host style detected via `Host` header. |
| TLS | Terminated upstream. OpenBucket itself listens on plain HTTP inside the container. |
| Process model | Single Node process. No worker threads for the hot path; lifecycle/cleanup runs on a background tick in the same process. |

---

## 3. Component map

```
                ┌──────────────────────────────────────┐
                │  openbucket container (one process)  │
                │                                       │
   HTTP :9000 ──▶│   NestJS app                          │
                │   ├── /admin/*       → static SPA     │
                │   ├── /api/admin/*   → admin API      │
                │   └── /*             → S3 protocol    │
                │                                       │
                │   Domain services (shared)            │
                │   ├── BucketService                   │
                │   ├── ObjectService                   │
                │   ├── MultipartService                │
                │   ├── LifecycleService                │
                │   └── KeyService                      │
                │                                       │
                │   Storage layer                       │
                │   ├── BlobStore  ─────────┐           │
                │   └── MetaStore ──┐       │           │
                └───────────────────┼───────┼───────────┘
                                    ▼       ▼
                  /data/openbucket.db    /data/blobs/<bucket>/<key>
                       (SQLite WAL)        (one file per object)
```

The S3 controller tree and the admin API controller tree both depend on the same domain services. There is exactly one copy of the business logic.

---

## 4. Network surface

### 4.1 Single port

Port `9000` carries three traffic types:

| Match | Handler |
|---|---|
| `Host` matches `<bucket>.<endpoint>` | S3 virtual-host style |
| Path starts with `/admin/` | Angular SPA static files (with `index.html` fallback for client routing) |
| Path starts with `/api/admin/` | Admin JSON API |
| Anything else | S3 path-style |

Routing is decided once per request by a classifier middleware. See `BACKEND-DESIGN.md` §1 for the implementation.

### 4.2 Virtual-host vs path style

- **Path style:** `GET /<bucket>/<key>` — works regardless of DNS.
- **Virtual-host style:** `GET /<key>` with `Host: <bucket>.<endpoint>` — works when the endpoint domain has wildcard DNS (`*.s3.example.com → <server>`).

The classifier looks at the `Host` header first. If the leftmost label parses as a known bucket and the remaining suffix matches the configured endpoint, it's virtual-host style; otherwise it falls back to path style.

### 4.3 Endpoint configuration

The container takes an `OPENBUCKET_ENDPOINT` env var (e.g. `s3.example.com`). When set, virtual-host style is enabled. When unset, only path style is accepted.

---

## 5. On-disk layout

```
<DATA_DIR>/
  openbucket.db              # SQLite main file
  openbucket.db-wal          # WAL
  openbucket.db-shm          # shared memory
  blobs/
    <bucket>/
      <encoded-key>          # one file per object (latest version)
      <encoded-key>.v/       # only present if bucket has versioning enabled
        <version-id>         # one file per non-current version
  multipart/
    <upload-id>/
      <part-number>.part     # staged part during multipart upload
  tmp/                       # short-lived scratch space (atomic rename targets)
  trash/                     # objects pending lifecycle deletion (TTL-gated)
```

**Invariants**

- Every file in `blobs/` corresponds to a row in the `objects` table. Orphan blobs are reconciled on startup by a scan.
- Every row in the `multipart_uploads` table corresponds to a directory under `multipart/`. Abandoned uploads are swept by lifecycle.
- `tmp/` is never read by clients. It exists so writes can land on the same filesystem as their final destination, making `rename(2)` atomic.

---

## 6. Key encoding

S3 keys are arbitrary UTF-8 byte strings of length 1–1024. Host filesystems impose stricter rules (path separators, reserved characters, case folding, length caps). OpenBucket reconciles this with a **percent-encoding pass** at the storage boundary only — the SQLite row holds the raw key; the filename holds the encoded form.

**Rules**

- ASCII alphanumerics, `-`, `_`, `.`, `~` pass through unchanged.
- `/` in the key is preserved as `/` in the path — keys form directory hierarchies on disk, matching S3's "folder" convention.
- Everything else (including non-ASCII bytes) is percent-encoded byte-by-byte: each byte becomes `%XX`.
- Leading `.` in any path segment is encoded as `%2E` to avoid hidden files on Unix.
- Trailing `.` or space in any segment is encoded to avoid Windows host quirks (forward-compatible, even though prod is Linux).
- Maximum encoded path segment length is 255 bytes. Keys whose encoded form exceeds this are rejected at the admin/S3 layer with `KeyTooLongError`.

The encoding is deterministic and reversible. The reverse mapping is used only for diagnostics — normal request flow reads the key from SQLite, not from the filename.

---

## 7. Metadata model (conceptual)

SQLite holds the source of truth for everything that isn't a blob payload. Concrete entity definitions live with the backend code; the conceptual model:

| Table | Holds |
|---|---|
| `buckets` | name, region (always `us-east-1` by default), creation time, versioning state, object-lock config, encryption config, CORS rules, lifecycle rules (JSON), tagging (JSON), policy (JSON) |
| `objects` | bucket+key, current version id, size, ETag, content-type, user metadata (JSON), tagging (JSON), lock state, storage class, created/modified time |
| `object_versions` | bucket+key+version-id, prior versions (when versioning enabled or suspended) |
| `multipart_uploads` | upload id, bucket+key, initiator, initiated time, encryption config |
| `multipart_parts` | upload id, part number, size, ETag, written-at |
| `access_keys` | access key id, hashed secret, label, created time, disabled flag |
| `admin_users` | username, password hash (argon2id), created time |
| `refresh_tokens` | hashed token, subject, issued, expires, rotated-from |
| `lifecycle_state` | per-rule cursor for incremental sweep |

**Atomicity.** Object writes commit in two phases: blob is staged in `tmp/` then renamed; only after a successful rename is the SQLite row inserted/updated, inside a transaction. A crash between rename and commit leaves an orphan blob, which the startup scan reconciles.

---

## 8. Concurrency model

- **One Node process**, no clustering. Concurrency is cooperative inside Node's event loop.
- **SQLite in WAL mode** allows many concurrent readers and one writer. The single-writer constraint is fine because individual writes are short — `objects` row updates are O(1) on indexed columns.
- **File I/O** for object bodies is unbounded in parallelism (Node's libuv thread pool, default size 4 — increased to 16 via `UV_THREADPOOL_SIZE` to give multipart room).
- **Multipart parts** for the same upload are serializable per part number (last-writer-wins, per AWS semantics). Across part numbers, parallel writes are fine because they land in distinct files.
- **Object overwrites** in a non-versioned bucket: the new blob lands in `tmp/`, the row update + rename happen together. Readers in flight see the old file until their stream completes — POSIX guarantees the fd stays valid even after the path is replaced.

---

## 9. Background work

A single in-process tick drives lifecycle and housekeeping:

| Task | Interval | Notes |
|---|---|---|
| Lifecycle sweep | every 60s | walks `lifecycle_state` cursor; never holds the EM open across the whole sweep |
| Multipart cleanup | every 5 min | removes `multipart/<upload-id>/` directories older than configured TTL with no recent activity |
| Trash purge | every 5 min | deletes files in `trash/` past their grace period |
| Orphan blob scan | once on startup | compares `blobs/` tree against `objects` rows; logs (does not auto-delete) |

No external scheduler. No worker process. If background work is slow, request handling is still on the main event loop and stays responsive because filesystem operations yield.

---

## 10. Versioning, lock, and encryption — design intent

Specifics belong with implementation; design intent here:

- **Versioning** is per-bucket and three-valued: `disabled` (default, no version ids), `enabled` (each PUT creates a new version, prior versions retained), `suspended` (PUT writes the "null" version, prior versions retained but no new ones created).
- **Object lock** is per-bucket, opt-in at bucket creation only (cannot be turned on later — matches AWS). Modes: `governance` (admin can override via `x-amz-bypass-governance-retention`), `compliance` (no override). Retention is per-object. **Enforced** on delete as of STORY-0121.
- **Server-side encryption.** SSE-S3 **encrypts object payloads at rest** (STORY-0122): when a bucket has `AES256` default encryption, objects are written **AES-256-CTR** with a per-object IV, under a single backend-managed key (`OPENBUCKET_SSE_KEY`, else generated + persisted to `<DATA_DIR>/sse.key`). CTR keeps `Range` GET seekable; ETag/size stay over plaintext. `aws:kms` is rejected; bring-your-own-key (`SSE-C`) and KMS remain out of scope.

---

## 11. Open questions

> **Resolution status (2026-06-24) — see `docs/pm/S11-DECISIONS.md` for the
> grounded brief.** Resolved: chunked-upload signing ✅ (STORY-0119 signed +
> 0120 unsigned-trailer); object-lock semantics ✅ (enforced, STORY-0121);
> lifecycle cadence ✅ (cron sweep), abandoned-multipart TTL ✅ (`MULTIPART_TTL_HOURS`,
> default 24h), CORS preflight ✅ (per-bucket) — all built in M5; server-side
> encryption ✅ (AES-256-CTR at rest, STORY-0122). Documented-deferred (no v1 forcing function): bucket-policy
> enforcement, migration path, backup CLI, endpoint-discovery UX.

The following are not yet decided. Each needs a call before implementation reaches that subsystem.

- **Chunked-upload signing.** Implement `STREAMING-AWS4-HMAC-SHA256-PAYLOAD`, or reject and require unsigned-payload-with-trailer? (See `BACKEND-DESIGN.md` §4.2.)
- **Object lock semantics.** Full WORM (compliance + governance + legal hold), or compliance-mode subset for v1?
- **Lifecycle evaluation cadence.** Cron-driven sweep (chosen above), or event-driven on every write? Event-driven scales better but complicates retries.
- **Abandoned multipart TTL.** How long before we sweep? AWS default is "never until you ask"; MinIO defaults to 24 h.
- **Server-side encryption.** Single backend-managed key (simplest), per-bucket key (slightly safer blast radius), or KMS-style envelope with what KMS?
- **Bucket policies.** How much of the AWS IAM policy grammar do we support? `Allow`/`Deny` with `Principal: "*"` and `Action` glob is probably enough; full condition language is out of scope.
- **CORS preflight.** Per-bucket rules (matches AWS), or single global config? AWS parity says per-bucket.
- **Migration path.** SQLite schema migrations are forward-only — what's the strategy if v2 needs a destructive change? Export/import via an offline tool, or in-place online migration?
- **Backup story.** Volume snapshot is "good enough" given WAL checkpointing on shutdown, but do we ship a documented `openbucket dump` / `openbucket restore` CLI?
- **Endpoint discovery for virtual-host style.** What's the UX when `OPENBUCKET_ENDPOINT` is unset and a client sends a virtual-host-style request? Silent fall-through to path style, or explicit error?
