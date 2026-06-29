# OpenBucket — Product management tree

This directory decomposes [`docs/WHITEPAPER.md`](../WHITEPAPER.md)
(~9,000 lines of implementation plan for the OpenBucket S3-compatible
object store) into a fully-traceable hierarchy of Epics, Stories,
Tasks, and Test Plans.

Every code sample, interface contract, error code, route pattern,
entity, and test sample mentioned in the white paper is traceable to
at least one Task here, with strict line-number citations back to the
source.

---

## Summary counts (all `backlog`)

| Artifact   | Count |
|------------|-------|
| Epics      | 6     |
| Stories    | 94    |
| Tasks      | 296   |
| Test Plans | 126   |

**Test Plans by level**

| Level       | Count |
|-------------|-------|
| Unit        | 71    |
| E2E         | 39    |
| Conformance | 16    |

**Tasks by type**

| Type           | Count |
|----------------|-------|
| Implementation | 295   |
| Spike          | 1     |

---

## Status legend

| Status        | Meaning                                                                |
|---------------|------------------------------------------------------------------------|
| `backlog`     | Recorded, not yet refined. Default.                                    |
| `ready`       | AC explicit, deps satisfied, ready to pick up.                         |
| `in_progress` | Actively being worked on.                                              |
| `review`      | Submitted; awaiting acceptance.                                        |
| `done`        | Merged and verified.                                                   |
| `blocked`     | Cannot progress until an external condition clears. Reason in body.    |

Full workflow rules: [`conventions/workflow.md`](./conventions/workflow.md).

---

## Epics

| ID      | Title                                              | Stories | Tasks | Tests | White paper |
|---------|----------------------------------------------------|---------|-------|-------|-------------|
| EPIC-01 | [Backend architecture & bootstrap](./epics/EPIC-01-backend-architecture.md) | 15 | 43 | 17 | §1 (49–1051) |
| EPIC-02 | [S3 wire protocol & SigV4](./epics/EPIC-02-s3-protocol-and-sigv4.md) | 19 | 64 | 37 | §2 (1052–2814) |
| EPIC-03 | [Persistence & storage layer](./epics/EPIC-03-persistence-and-storage.md) | 14 | 38 | 14 | §3 (2815–5192) |
| EPIC-04 | [Streaming, concurrency & background work](./epics/EPIC-04-streaming-and-concurrency.md) | 20 | 63 | 28 | §4 (5193–6658) |
| EPIC-05 | [Admin API, frontend & auth flow](./epics/EPIC-05-admin-frontend-and-auth.md) | 20 | 59 | 26 | §5.1–§5.15 (6659–8324) |
| EPIC-06 | [Build, CI & release](./epics/EPIC-06-build-ci-and-release.md) | 6 | 29 | 4 | §5.16–§5.20 (8325–8947) |

### Dependency graph

```
EPIC-01 ──┬──▶ EPIC-03 ──┬──▶ EPIC-04 ──┐
          │              │              ├──▶ EPIC-02 ──▶ EPIC-06
          │              │              │
          └──▶ EPIC-05 ──┴──────────────┘
```

---

## Top-level artifacts

- [`STATUS.md`](./STATUS.md) — live dashboard. Regenerate with `./scripts/pm-status.sh`.
- [`BACKLOG.md`](./BACKLOG.md) — every Story in dependency-respecting topological order.
- [`ROADMAP.md`](./ROADMAP.md) — Stories grouped into delivery milestones M0–M7.
- [`conventions/getting-started.md`](./conventions/getting-started.md) — **Day-1 walkthrough.** Start here.
- [`conventions/templates.md`](./conventions/templates.md) — the four artifact templates.
- [`conventions/ids.md`](./conventions/ids.md) — ID scheme, slug rules, range partitions.
- [`conventions/workflow.md`](./conventions/workflow.md) — status workflow + refinement checklists.
- [`conventions/glossary.md`](./conventions/glossary.md) — project terminology.

## Directory tree

```
docs/pm/
  README.md            # this file
  BACKLOG.md           # topologically ordered Story list
  ROADMAP.md           # milestone groupings
  conventions/
    templates.md       # the four artifact templates
    ids.md             # ID scheme + reserved ranges
    workflow.md        # status workflow
    glossary.md        # project terms
  epics/               # 6 files
  stories/             # 94 files
  tasks/               # 296 files
  test-plans/          # 126 files
```

---

## How to use this PM tree

**First time?** Read [`conventions/getting-started.md`](./conventions/getting-started.md).
It walks through the Day-1 status flips (`backlog → ready → in_progress → review → done`)
with concrete commands.

**To see the current state of play**: run `./scripts/pm-status.sh`
and open [`STATUS.md`](./STATUS.md). It shows counts by status, the
next `ready` Story, what's in progress, what's blocked, and milestone
progress.

**To pick up the next piece of work**: open `BACKLOG.md` and scan
top-to-bottom for the first Story whose status is `ready`. Read the
Story file; it lists its Tasks and Test Plans. Each Task names the
exact files to create or modify and quotes the relevant white-paper
signatures verbatim. Move the Task to `in_progress`, implement, then
move to `review`.

**To understand what a Story is about**: every Story references the
relevant `docs/WHITEPAPER.md` subsection with exact line numbers.
Read those lines first; they define what is being implemented.

**To plan a release**: open `ROADMAP.md`. Each milestone has explicit
exit criteria. M(n+1) cannot begin until M(n) is green.

**To trace a code sample back to product intent**: search for the
file path in `tasks/` — every Task lists its target files in `Files
to create / modify`. The Task's parent Story explains why; the Epic
explains the strategic context.

**To add a new Story**: allocate the next ID in your Epic's reserved
range (see `conventions/ids.md`). Use the Story template verbatim.
Reference the white-paper section it derives from. Add the Story to
its Epic's `## Stories` list and append it to `BACKLOG.md` and the
appropriate `ROADMAP.md` milestone.

**Never renumber.** IDs are permanent.

---

## Completeness audit (Stage 3)

The following checks were performed before declaring the tree
complete:

- [x] §1.1–§1.10 each appear as Stories or Tasks under EPIC-01.
- [x] §2.1–§2.10 each appear under EPIC-02; the operation route table
      (§2.8) is split into one Story per resource family (Service,
      Bucket, Object, Multipart, Tagging/ACL/Policy, CORS, Versioning,
      Lifecycle, Object Lock, Encryption).
- [x] §3.1–§3.11 each appear under EPIC-03; every entity in §3.2 is
      its own Task; the BlobStore methods in §3.6 are individual Tasks.
- [x] §4.1–§4.12 each appear under EPIC-04; each background tick
      (lifecycle, multipart cleanup, trash purge, orphan scan) is its
      own Story (STORY-0314, 0315, 0316, 0317).
- [x] §5.1–§5.15 each appear under EPIC-05; §5.16–§5.20 under EPIC-06.
- [x] Cross-Epic interface contracts identified:
  - `OpenBucketRequestContext` (`req.openbucket`) — produced by STORY-0005, consumed by EPIC-02 + EPIC-05.
  - `AppConfigService` — produced by STORY-0011, consumed by every Epic.
  - `ShutdownState` — produced by STORY-0014, consumed by EPIC-04 (STORY-0319).
  - `S3Error` (final) — produced by STORY-0105, scaffolded by STORY-0009.
  - `BlobStore` (5 methods) — produced by STORY-0208, consumed by EPIC-04.
  - `KeyService.getSecret` — produced by STORY-0212, consumed by EPIC-02 (STORY-0103).
  - `@Public()` decorator — owned by EPIC-05, referenced by STORY-0012.
  - `BlobStoreHealth.canWrite()` — owned by EPIC-03, referenced by STORY-0012 readiness probe.
- [x] No two artifacts share the same ID (verified by sort/uniq pass over 522 files).
- [x] All 94 Stories have at least one Test Plan attached.
- [x] BACKLOG.md ordering is a valid topological sort at the Epic level (01 → 03 → 04 → 05 → 02 → 06) and at the Story-ID level within each Epic.

### Known soft gaps

These do not block work starting; they were noted by Epic agents during decomposition:

- **Orphan scan lookup name.** EPIC-04 STORY-0317 (OrphanScanRunner) needs a `findByPath`-shaped lookup on `ObjectService`. EPIC-03 did not pre-declare it under STORY-0210. **Action:** add a Task to STORY-0210 that declares the lookup with a concrete signature before STORY-0317 starts.
- **§1.7 prose vs schema.** Lines 706–817 list `OPENBUCKET_REGION` and `PORT` among refuse-to-boot vars, but the Zod schema gives both defaults. The EPIC-01 agent treated the schema as authoritative (no spike filed). **Action:** confirm or update the white paper.
- **`mustChangePassword` enforcement.** STORY-0412 documents this as advisory at v1 (claim drives SPA redirect; API does not block). **Action:** flag as a v1.1 hardening item if/when policy tightens.

### Spike Tasks

| Task ID  | Description                                                                       |
|----------|-----------------------------------------------------------------------------------|
| TASK-1523 | Verify `nrwl/nx-set-shas@v4` affected-base derivation (under STORY-0503).         |
