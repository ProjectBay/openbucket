# OpenBucket — Correctness-Under-Failure Audit

Scope: durability & consistency guarantees vs. S3 expectations. **Single-node**
architecture (NestJS + MikroORM/**better-sqlite3** for metadata + **local
filesystem** for blob payloads); there is no replication / erasure coding /
quorum layer, so the *distributed* attack classes (split-brain, node loss,
partition) do not apply and are out of scope.

Everything below was established by reading the code (`file:line` cited) and, for
the confirmed findings, by a **reproducible fault-injection script** under
`tests/fault/`. Findings are split into **PROVEN** (a running repro demonstrates
the violation) and **CODE-ESTABLISHED** (the code path is cited but a runnable
repro is pending or requires fault tooling unavailable in this Windows
environment). Nothing is claimed broken without either a repro or a direct code
citation.

Environment note: this audit ran on Windows. Deterministic *crash* injection is
done with an env-gated failpoint (`OB_FAULT`, see `libs/nestjs/src/lib/common/faultpoint.ts`).
True **power-loss / block-layer** faults (torn `fsync`, lost dir entry, ENOSPC
mid-write) need Linux tooling (`dm-flakey`, a FUSE shim) and are flagged as
env-limited where relevant.

---

## 0. Remediation status — ALL FINDINGS FIXED

Every finding was fixed on branch `fault-hardening`. The full nestjs unit suite
(523 passing, 3 pre-existing skips) and the fault-audit suite
(`node tests/fault/run-all.mjs`, **0 violations**) are green.

| # | Finding | Fix | Commit |
|---|---|---|---|
| F1 | Silent corruption at rest | getObject re-reads + verifies blob hash vs. stored ETag before sending; 500 on mismatch | cd16d9e |
| F2 | Failed overwrite destroys object | hard-link the old blob aside; restore inline on error | cd16d9e |
| F3 | Crash → row↔content mismatch | backup-aside + recovery reconcile; per-key write lock | cd16d9e |
| F4 | `x-amz-checksum-*` ignored | verify every declared checksum (crc32/crc32c/sha1/sha256) on ingest | 45f2c36 |
| F5 | Multipart bypasses SSE | composeBlobs/putComposed encrypt + store per-object IV | 814da5c |
| F6 | Concurrent same-key tear | per-(bucket,key) write mutex | cd16d9e |
| F7 | Multipart Complete/Abort races | per-uploadId mutex | e83ce4c |
| F8 | Power-loss barriers | directory fsync after rename + SQLite `synchronous=FULL` | 45f2c36 |
| F9 | Orphan blobs never deleted | recovery reaps orphans (misconfiguration-guarded) | ad155e7 |
| F10 | Non-contiguous parts rejected | accept sparse part numbers; reject duplicates | ad155e7 |
| F11 | EXDEV copy not fsync'd | fsync dest + dir after the copy fallback | 45f2c36 |
| bonus | Multipart Complete failed for AWS SDK v3 (XML-escaped `&quot;` ETag) | `dequote` decodes the quote entity | 814da5c |

Two deliberate approach choices:

- **F1 uses read-time hash verification, not AES-GCM.** The corruption repro is on
  a *non-encrypted* bucket, so GCM alone wouldn't close it; read-verify covers
  encrypted *and* plaintext objects, preserves Range GETs, and SSE stays
  AES-256-CTR. **Update:** getObject now stores a whole-object plaintext SHA-256
  (`contentSha256`, migration `Migration20260701000001`) and verifies it before
  sending, so corruption is caught for **full GETs of any object (single-part AND
  multipart)** and for **Range GETs up to 64 MiB** (`RANGE_VERIFY_MAX_BYTES` — a
  range read must re-read the whole object to verify). The only remaining gap is a
  range read of an object *larger* than that cap, which is served unverified; the
  scalable fix is per-block checksums. Covered by
  `tests/fault/attack-corruption-range-multipart.mjs`.
- **F2/F3 use backup-aside + recovery reconcile, not content-addressed paths.** It
  achieves the same crash-atomic-overwrite guarantee (a failed or half-written
  overwrite never loses the prior object) with no entity change or DB migration.

The attack scripts now assert the FIXED behavior, so `node tests/fault/run-all.mjs`
is a regression gate: it exits 0 today and non-zero if any fix regresses.

---

## 1. Guarantee map (Phase 0)

| # | Claimed guarantee (source) | Enforcing / violating code | Failure that breaks it | Status |
|---|---|---|---|---|
| G1 | "a GET returns the bytes that were PUT" (S3 implicit) | `object.service.ts:376-448` GET streams raw bytes; ETag from DB row (`:409`), never recomputed; SSE = AES-256-CTR **no MAC** (`sse-cipher.ts:15`); no scrub (`recovery.service.ts` existence-only) | Flip a byte at rest → served silently | **BROKEN — F1 (proven)** |
| G2 | "row committed, file missing — prevented by construction" (whitepaper `03-persistence-and-storage.md:1830`) | `object-writer.service.ts:131-141` catch → `fs.unlink(finalPath)` | A failed **overwrite** unlinks the blob the surviving old row points at | **BROKEN — F2 (proven)** |
| G3 | "keeps the two consistent across crashes / atomic writes" (`03…:3`, `ARCHITECTURE.md:160`) | rename `object-writer.service.ts:90` **before** commit `:129`; Content-Length from row `object.service.ts:419` | Crash between rename & commit on an **overwrite** → old metadata, new bytes | **BROKEN — F3 (proven)** |
| G4 | S3 flexible checksums verified on ingest | `put-object.interceptor.ts:188-193` (only Content-MD5 + content-sha256); `chunked-decoder.ts:196-198` (non-crc32 trailers unvalidated) | Wrong `x-amz-checksum-sha256` on a regular PUT | **BROKEN — F4 (proven)** |
| G5 | SSE-S3 encrypts objects at rest (README/admin "default encryption") | single-shot `object-writer.service.ts:82-90` encrypts; multipart `putComposed` (`:152-216`) + `composeBlobs` (`blob-store.ts:223-276`) have **no cipher** | Multipart-upload an object to an AES256 bucket | **BROKEN — F5 (code-established)** |
| G6 | concurrent same-key PUT "last-rename-wins" (`s3/CONCURRENCY.md:11`) | **no** per-key lock (grep: none in `storage/`); loser `object-writer.service.ts:135` unlinks shared `finalPath` | Two concurrent PUTs to one key | **BROKEN — F6 (code-established; quarantined test `concurrency.spec.ts:133`)** |
| G7 | multipart Complete is correct under concurrency | `multipart.service.ts:143-183` no lock/txn on `uploadId` | Complete×Complete or Complete×Abort race | **WEAK — F7 (code-established)** |
| G8 | "a 200 means durable" (implied) | blob data fsync'd `blob-store.ts:97`; **no dir fsync**; SQLite WAL `synchronous=NORMAL` `persistence.module.ts:112` | Power loss after a 200 | **GAP — F8 (env-limited)** |
| G9 | "crash leaves an orphan blob which the startup scan reconciles" (`ARCHITECTURE.md:160`) | `recovery.service.ts:26-31,90-97` logs orphans, **never deletes**; no reverse/content pass | Repeated crashes | **WEAK — F9 (leak)** |
| — | Content-MD5 / content-sha256 enforced; create-path ordering; blob-data fsync; WAL survives *process* crash; multipart part validation; clean shutdown-abort | see §3 | — | **HELD** |

---

## 2. Findings

### F1 — Silent corruption at rest served on read  ·  CRITICAL (silent data corruption)

- **Guarantee violated:** a GET must not silently return corrupted bytes (G1).
- **Repro:** `node tests/fault/attack-corruption-at-rest.mjs`
- **Observed:** PUT an object; flip one byte in its on-disk blob; GET returns
  **HTTP 200 with the corrupted bytes** and the **original (stale) ETag**. The
  caller cannot tell.
- **Expected:** GET fails with a corruption/checksum error (or corruption is
  physically detectable).
- **Root cause:** `object.service.ts:376-448` streams the blob with no
  re-hash/compare; the `ETag` header is the stored DB value (`:409`), never
  recomputed from disk. SSE is **AES-256-CTR** (`sse-cipher.ts:15`) — a stream
  cipher with **no authentication tag**, so a ciphertext bit-flip decrypts to
  corrupted plaintext undetected. `recovery.service.ts` checks path/row existence
  only (`:90-97`) — no scrub, no content verification.
- **Fix:** store a strong per-object content hash (already have `sha256` at
  ingest — persist it) and verify it on read (streaming hash → compare on
  `end`, fail the response on mismatch), and/or switch SSE to **AES-256-GCM**
  (authenticated) so decryption itself detects tampering. Add an optional
  background scrub that re-hashes blobs and flags mismatches.

### F2 — A failed overwrite destroys the previously-durable object  ·  CRITICAL (silent data loss)

- **Guarantee violated:** "row committed, file missing — prevented by
  construction" (G2); PutObject atomicity (a failed write is a no-op).
- **Repro:** `node tests/fault/attack-overwrite-error-destroys-object.mjs`
  (injects a post-rename error with `OB_FAULT=after-rename OB_FAULT_MODE=throw`,
  simulating any disk/commit error at the write's tail).
- **Observed:** object v1 is stored durably (gets a 200). A later overwrite that
  fails **after the rename** leaves GET of the original key returning **404
  NoSuchKey** — the durable object is gone.
- **Expected:** the failed overwrite is a no-op; v1 remains readable.
- **Root cause:** `object-writer.service.ts:90` renames the new blob over the old
  one (destroying the old bytes) *before* the commit; on any post-rename error
  the `catch` at `:131-141` does `fs.unlink(finalPath)`. For an overwrite the
  transaction rolls back to the **old committed row**, but the unlink has deleted
  the blob that row points at → committed row, missing file — the exact state
  `03-persistence-and-storage.md:1830` calls impossible.
- **Fix:** never overwrite-in-place. Write the new blob to a **content-addressed
  / versioned path**, commit the row, then unlink the *old* path; on error unlink
  only the *new* path, never a path an existing committed row references. (I.e.
  the rename must publish a new name, and the row flip must be the linearization
  point, with cleanup that can never touch the live blob.)

### F3 — Crash between rename and commit → row↔content mismatch (torn read)  ·  CRITICAL (silent corruption)

- **Guarantee violated:** atomic, crash-consistent writes (G3).
- **Repro:** `node tests/fault/attack-crash-overwrite-mismatch.mjs`
  (`OB_FAULT=after-rename` → `process.exit(137)` between rename and commit, then
  restart and read).
- **Observed:** v1 (500 B) stored; overwrite with v2 (20 B) crashes after the
  rename. After restart, the committed row still describes **v1** (Content-Length
  500, v1's ETag) but the on-disk blob is **v2 (20 B)**. GET returns a response
  whose declared `Content-Length` (500) does not match the body (20 B) → a
  truncated/inconsistent read the S3 client rejects. Recovery never notices.
- **Expected:** after a crash the object is atomically all-v1 or all-v2, with
  metadata matching bytes.
- **Root cause:** same rename-before-commit ordering (`object-writer.service.ts:90`
  vs `:129`); `object.service.ts:419` serves `Content-Length` from the (stale)
  row; `recovery.service.ts` has no reverse pass and never compares row
  size/ETag to the file.
- **Fix:** same as F2 (publish-new-name + row-flip-as-linearization-point). A
  recovery pass that reconciles row size/ETag against the blob (or refuses to
  serve a mismatched object) would at least turn silent corruption into a loud
  error.

### F4 — `x-amz-checksum-*` ignored on a regular PUT  ·  HIGH (silent ingest corruption)

- **Guarantee violated:** S3 flexible-checksum integrity on ingest (G4).
- **Repro:** `node tests/fault/attack-ingest-checksum.mjs` (raw aws4-signed PUT
  with a deliberately wrong checksum; includes a Content-MD5 control that is
  correctly rejected).
- **Observed:** a wrong **`x-amz-checksum-sha256`** on a regular PUT returns
  **HTTP 200** (accepted). (Control: a wrong `Content-MD5` → 400 BadDigest, so
  *some* integrity is enforced.)
- **Expected:** BadDigest (400) on any declared-checksum mismatch.
- **Root cause:** `put-object.interceptor.ts` verifies only `content-md5` and
  `x-amz-content-sha256` (`:188-193`); `x-amz-checksum-{crc32c,sha1,sha256}` are
  read only in the chunked-trailer path, and there only crc32 is validated —
  `chunked-decoder.ts:196-198` explicitly "accepts without validation". The
  `MultipartPart.checksumSha256` column exists but is never populated.
- **Fix:** in the ingest verifier, compute and compare every declared
  `x-amz-checksum-*` header (crc32/crc32c/sha1/sha256), rejecting mismatches
  with BadDigest, for both regular and chunked uploads.

### F5 — Multipart uploads bypass SSE-S3 encryption  ·  HIGH (silent confidentiality loss)  ·  CODE-ESTABLISHED

- **Guarantee violated:** "objects in an encrypted bucket are encrypted at rest"
  (G5).
- **Root cause:** the single-shot path encrypts (`object-writer.service.ts:82-90`),
  but `putPart` writes plaintext (`blob-store.ts:121-148`), `composeBlobs` takes
  no cipher (`blob-store.ts:223-276`), and `putComposed` never sets `encryption`
  (`object-writer.service.ts:152-216`). An object uploaded via multipart to an
  `AES256`-default bucket is stored **unencrypted** with `row.encryption`
  undefined. `putComposed` also skips the object-lock/retention enforcement the
  normal put applies.
- **Repro status:** not scripted (requires enabling bucket default-encryption,
  which is an admin-API action needing a login). The code path is unambiguous.
- **Fix:** thread the bucket's encryption config + a per-object IV through
  `composeBlobs`/`putComposed` exactly as the single-shot path does; apply
  object-lock/retention checks there too.

### F6 — No per-key serialization: concurrent same-key PUT can tear/lose a write  ·  HIGH  ·  CODE-ESTABLISHED

- **Guarantee violated:** concurrent same-key PUT "last-rename-wins" (G6).
- **Root cause:** no per-`(bucket,key)` lock exists (grep for
  `Mutex|lock|semaphore|withLock` in `storage/` → none). Two concurrent writers
  compute the **same** `finalPath` (`blob-store.ts:78`); if the losing writer's
  transaction errors (e.g. the `uq_objects_bucket_key` unique constraint on a
  first-time insert), its `catch` unlinks `finalPath` (`object-writer.service.ts:135`)
  — deleting the **winner's** just-committed blob → winner's row points at a
  missing file.
- **Repro status:** the project's own `concurrency.spec.ts:133` (`it.skip`,
  quarantined) asserts this invariant and is disabled precisely because the write
  path does not guarantee it (see the comment at `concurrency.spec.ts:90-102`).
  A timing-based repro is inherently racy; the fix (per-key serialization) is the
  same as F2/F6 and would re-enable that test.
- **Fix:** a per-`(bucket,key)` async mutex around the write, plus the
  publish-new-name discipline from F2 so no cleanup can unlink a live blob.

### F7 — Concurrent multipart Complete / Abort are unsynchronized  ·  MEDIUM  ·  CODE-ESTABLISHED

- **Root cause:** `completeUpload` (`multipart.service.ts:143-183`) takes no lock
  and does not wrap the part-read + compose in one transaction; `abortUpload`
  (`:200-216`) likewise. Two concurrent Completes both `composeBlobs` and rename
  (last-rename-wins), and one racer's `fs.rm(staging)` can `ENOENT` the other's
  in-flight compose → spurious 500. Complete racing Abort can leave the object
  committed *despite* the abort. No "already completed" idempotency guard.
- **Fix:** serialize per `uploadId` (or a unique "completing" state transition);
  make compose read the staged parts under isolation; make Complete idempotent.

### F8 — Durability barrier gaps under power loss  ·  MEDIUM  ·  ENV-LIMITED

- **Root cause (two separate durability domains):**
  1. **Blobs:** data blocks are fsync'd before the 200 (`blob-store.ts:97`), but
     the containing **directory is never fsync'd** after the rename (no dir-fsync
     anywhere in `libs/nestjs/src`). On power loss the fsync'd bytes can survive
     while the rename/dir-entry that publishes them at the final path is lost.
  2. **Metadata:** SQLite is WAL + **`synchronous=NORMAL`** (`persistence.module.ts:112`,
     `mikro-orm.config.ts:79`) with no per-commit fsync and no manual checkpoint
     (`wal_autocheckpoint` left at default; only `orm.close(true)` on *graceful*
     shutdown checkpoints). On power loss the last committed transaction(s) can be
     lost — while the corresponding blob (fsync'd) survives → orphan.
- **Consequence:** a client that saw a 200 can, after power loss, find the object
  unreadable (lost dir entry) or absent (lost metadata commit). The DB stays
  uncorrupted (NORMAL relaxes durability, not integrity).
- **Repro status:** **not reproducible with a process crash** — a SIGKILL keeps
  the OS page cache, so the rename and the WAL survive (the F2/F3 repros confirm
  v1 survives a process crash). Demonstrating the actual loss needs power-loss /
  block-layer injection (`dm-flakey`, a fault FUSE) on Linux. The *barrier's
  absence* is established by code (only `fh.sync()` on the tmp file at
  `blob-store.ts:295`; `synchronous=NORMAL`).
- **Fix:** fsync the containing directory after the rename (and after the
  EXDEV-fallback copy). For metadata that must be power-loss durable, use
  `synchronous=FULL` for the object-commit transactions (or checkpoint + fsync on
  the write path), accepting the throughput cost — or document that a 200 is
  crash-durable but not power-loss-durable.

### F9 — Recovery logs orphan blobs but never deletes them  ·  LOW (unbounded disk leak)

- **Root cause:** `recovery.service.ts:26-31,90-97` reports orphan blobs (blob on
  disk, no row) but never removes them (by design in v1). Every crash between
  rename and commit (F3's create case) leaks a blob forever; the on-boot scan
  also does a full blob walk each start.
- **Fix:** quarantine/delete orphans older than a grace window, or reference-count
  and GC. (Deliberately not auto-deleting is defensible, but it should at least
  be an opt-in reaper.)

### F10 — Multipart Complete requires contiguous part numbers  ·  LOW (interop)

- `multipart.service.ts:150-153` (`InvalidPartOrderError`) rejects non-contiguous
  part numbers (e.g. `[1,2,4]`), which real S3 permits. A conformant client using
  sparse part numbers fails. Not a durability bug; noted for completeness.

### F11 — EXDEV rename fallback is copy+unlink (non-atomic, no fsync)  ·  LOW

- `blob-store.ts:307-319`: if tmp and final are on different filesystems, the
  "atomic rename" degrades to `copyFile` + `unlink` with no fsync — breaking the
  "never appears partially" guarantee if `DATA_DIR`'s `tmp/` and blob tree span
  filesystems. Keep `tmp/` on the same filesystem as the blobs (it is, by
  default) and fsync after the copy.

---

## 3. Guarantees that held

Tried and could **not** break (with the evidence):

- **Content-MD5 / `x-amz-content-sha256` on ingest** are enforced — a wrong
  Content-MD5 → 400 BadDigest (control in `attack-ingest-checksum.mjs`;
  `put-object.interceptor.ts:188-193`).
- **Create-path crash consistency** — a crash between rename and commit for a
  *new* key leaves an orphan blob and **no** dangling row (the row is never
  written before the blob is durable). The "row → missing file" break is
  specific to **overwrites** (F2). (`object-writer.service.ts:58-129`.)
- **Blob data is fsync'd before the 200** — `fh.sync()` on the staged file
  (`blob-store.ts:97,295`); the 200 is sent only after `writer.put` resolves
  (`object.service.ts:229`). (The remaining gap is the *directory* fsync, F8.)
- **Metadata survives a process crash** — WAL + `synchronous=NORMAL` does not
  lose committed transactions or corrupt the DB on SIGKILL (the F2/F3 repros
  rely on v1 surviving the crash). The exposure is power-loss-only (F8).
- **Multipart part validation** — Complete validates each declared part's
  presence, ETag, and ≥5 MiB min (except last), and computes the correct S3
  multipart ETag `md5(concat(part-md5s))-N` (`multipart.service.ts:150-171`).
- **Graceful-shutdown abort is clean** — a write interrupted by shutdown's
  socket destroy errors the pipeline and unlinks the tmp file; no torn final blob
  (`blob-store.ts:95-101`, `shutdown.service.ts:83-95`).

---

## 4. Running the harness

Prereqs: a built backend (`npx nx build openbucket-backend`) and installed deps
(`@aws-sdk/client-s3`, `aws4`, `better-sqlite3` — all present).

```bash
# individual attacks (each spawns a disposable app in a scratch DATA_DIR):
node tests/fault/attack-corruption-at-rest.mjs
node tests/fault/attack-overwrite-error-destroys-object.mjs
node tests/fault/attack-crash-overwrite-mismatch.mjs
node tests/fault/attack-ingest-checksum.mjs

# or all of them:
node tests/fault/run-all.mjs
```

Each script prints per-check ✓/✗ and, on a violation, a `⚠ FINDING` block with
observed-vs-expected. **Exit code = number of violated guarantees** (0 = all
held), so once a bug is fixed its script turns green and becomes a regression
gate. To wire into CI, add a job that runs `node tests/fault/run-all.mjs` after
`nx build openbucket-backend` (allow-failure until the CRITICALs are fixed, then
make it required).

### Harness internals (`tests/fault/harness.mjs`)
- `spawnApp({port?, dataDir?, fault?, env?})` — spawns the built app against a
  scratch (or reused) `DATA_DIR`, waits for `/api/admin/health` via **core
  `http`** (this environment routes Node's global `fetch`/undici through a
  corporate proxy that can't reach `127.0.0.1`; the AWS SDK uses core `http`, so
  it's fine). Returns `{port, dataDir, kill, waitExit, ...}`.
- `s3(port)` — an `@aws-sdk/client-s3` client (path-style, root SigV4, retries
  off so faults surface deterministically).
- disk faults: `blobFiles`, `flipByte`, `overwrite`, `truncateTo`.
- DB inspection: `openDb`, `objectRows`, `tableNames` (read-only).
- **Failpoints:** deterministic crash injection via `OB_FAULT` +
  `libs/nestjs/src/lib/common/faultpoint.ts` — a no-op unless `OB_FAULT` names
  the point (never set in prod/CI). Currently one point, `after-rename`, in
  `object-writer.service.ts`; add more `await faultpoint('name')` calls to probe
  other windows.

### Not covered here (needs Linux block-layer tooling)
Power-loss durability (F8) — torn/lost `fsync`, lost directory entry, ENOSPC
mid-write — requires `dm-flakey` / a fault-injecting FUSE layer. The barrier's
*absence* is code-established; the loss itself is not reproducible on Windows
with a process crash.
