# §11 open-question decisions brief

Grounding `docs/ARCHITECTURE.md` §11 against what the code actually does today
(2026-06-24), so each open question becomes a ratify-or-build decision rather
than blank design. **These are findings + recommendations for sign-off, not
unilateral decisions.**

## TL;DR

| # | §11 question | Status in code | Recommendation |
|---|---|---|---|
| 1 | Chunked-upload signing | ✅ **Resolved** — STORY-0119 (signed) + 0120 (unsigned-trailer), real-client verified | Done. |
| 2 | Object-lock semantics | ⚠️ **Config-complete, NOT enforced** | **Build enforcement** (real gap). |
| 3 | Lifecycle cadence | ✅ **Resolved** — cron sweep (`LifecycleSweepRunner`, cursor-paged) | Ratify "cron". |
| 4 | Abandoned multipart TTL | ✅ **Resolved** — `MULTIPART_TTL_HOURS` default **24h**, configurable | Ratify. |
| 5 | Server-side encryption | ✅ **Implemented** — AES-256-CTR at rest (STORY-0122) | Done. |
| 6 | Bucket policies | ⚠️ **Stored/parsed, NOT enforced** | **Defer** (no sub-principals in v1) + document. |
| 7 | CORS preflight | ✅ **Resolved** — per-bucket (STORY-0112/0117), AWS-parity | Ratify. |
| 8 | Migration path | 🔲 **Open** — forward-only, no destructive-change story | Document export/import; low urgency. |
| 9 | Backup CLI | 🔲 **Open** — none (`restoreObject` is the unrelated S3 archival no-op) | Volume snapshot for v1; CLI only on demand. |
| 10 | Endpoint discovery (vhost) | 🔲 **Minor** — `OPENBUCKET_ENDPOINT` optional; classifier falls through | Keep path-style fallback; document. |

**Headline:** two features are *advertised as supported but are effectively
no-ops on the security-critical path* — **object lock** (deletes aren't blocked)
and **SSE-S3** (data isn't encrypted). These are correctness/trust gaps, not
mere open questions, and should be the priority M7 work.

---

## The two real gaps

### #2 — Object lock is not enforced
- **Found:** modes (`off`/`governance`/`compliance`), `retainUntil`, and legal-hold
  are settable + gettable via the S3 API (`object.service.ts` get/setRetention,
  get/setLegalHold). **But `deleteOne` (object.service.ts:423) never checks the
  lock** — a delete under active retention or legal hold succeeds (soft-delete).
- **Why it matters:** object lock is a compliance/WORM feature; silently allowing
  the delete defeats its entire purpose and is worse than not advertising it.
- **Recommendation (build, ~M/S):** in `deleteOne` (and the bulk-delete + version
  delete paths), reject when `legalHold === true`, or `retainUntil > now()` —
  unless mode is `governance` **and** the request carries
  `x-amz-bypass-governance-retention: true` (root-only). `compliance` is never
  bypassable. Add e2e: locked object delete → `403 AccessDenied`.

### #5 — SSE-S3 stores config but doesn't encrypt
- **Found:** `?encryption` accepts `AES256` and rejects `aws:kms`
  (`bucket.service.ts:529`), persists `{ algorithm: 'AES256' }`, and echoes it.
  **But there is no cipher anywhere in the blob write/read path** — objects are
  stored plaintext on disk.
- **Why it matters:** "server-side encryption: supported" is a security claim;
  plaintext-at-rest makes it misleading.
- **Recommendation (decide):**
  - **(a) Implement real SSE-S3** — AES-256-GCM with a single backend-managed key
    (from a new `OPENBUCKET_SSE_KEY` / derived), encrypt on `putBlob`, decrypt on
    read, store the IV/tag alongside. Matches §10 design intent. ~L effort.
  - **(b) Relabel as advisory** — keep the config echo, document clearly that v1
    does not encrypt at rest (drop the "supported" wording). ~XS.
  - Recommend **(a)** if "encryption" is part of the value proposition; otherwise
    (b) honestly.
- **RESOLVED (2026-06-25): implemented (a).** AES-256-CTR at rest (STORY-0122, done) — verified e2e (ciphertext on disk, GET + Range round-trip). _(Historical note: an interim honest relabel preceded the implementation.)_ Original interim note: did **(b)** — the misleading "supported"
  wording is corrected in code comments + `ARCHITECTURE.md` §10 (config is stored
  + round-tripped; v1 does not encrypt at rest). Real at-rest encryption is
  tracked as **[STORY-0122]** (backlog, `status: backlog`), gated on a
  key-strategy decision + sign-off — *not* auto-implemented, since it is a
  one-way door for on-disk data.

---

## Resolved by the M5 build (ratify the decision, update §11 wording)

- **#3 Lifecycle cadence → cron.** `LifecycleSweepRunner` runs on the background
  tick with a per-rule cursor (§4.10); event-driven was *not* chosen. Ratify.
- **#4 Multipart TTL → 24h, configurable.** `MULTIPART_TTL_HOURS` (default 24,
  MinIO-style) drives `MultipartCleanupRunner`. Ratify.
- **#7 CORS → per-bucket.** STORY-0112/0117 implement per-bucket rules +
  preflight (AWS-parity). Ratify.

## Genuinely open, low urgency (decide when forced)

- **#6 Bucket policies — defer.** Policies are validated + stored but not
  evaluated. v1 is single-tenant (root-only S3 creds); there are no sub-principals
  to enforce a policy *against*, so an evaluator has nothing to do yet. Recommend
  keep store-only, document the limitation, and revisit when per-application
  sub-keys land (the §2 "future" item). Don't build an evaluator speculatively.
- **#8 Migration path — document.** SQLite migrations are forward-only. For a
  future destructive change, the low-cost answer is an offline export/import tool
  rather than online migration. Write it down; no code until a breaking change is
  actually needed.
- **#9 Backup CLI — snapshot for v1.** Volume snapshot + WAL checkpoint on
  shutdown is "good enough"; ship `openbucket dump`/`restore` only if there's
  real demand. No `restore` tooling exists today (the `restoreObject` handler is
  the unrelated S3 archival no-op).
- **#10 Endpoint discovery — keep current.** `OPENBUCKET_ENDPOINT` is optional;
  when unset, virtual-host-style requests fall through to path-style (the
  classifier never matches a vhost bucket). Recommend keep the silent fallback
  (least-surprise for path-style clients); document it. An explicit error would
  break clients that send a Host header but expect path-style.

---

## Suggested M7 sequencing
1. **Object-lock enforcement** (#2) — correctness gap, clear scope, testable.
2. **SSE-S3 decision** (#5) — pick (a) implement or (b) relabel; both are bounded.
3. Ratify #3/#4/#7 by updating §11 wording to "decided".
4. Leave #6/#8/#9/#10 documented-as-deferred until a forcing function appears.
