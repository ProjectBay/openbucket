# ID scheme

Every artifact has a stable, globally unique identifier. IDs are
allocated in writing order and **never renumbered**. Cross-references
inside artifacts use IDs only; the README/BACKLOG resolves IDs to paths.

## Format

| Artifact   | Format       | Range     | Example         |
|------------|--------------|-----------|-----------------|
| Epic       | `EPIC-NN`    | 01–99     | `EPIC-03`       |
| Story      | `STORY-NNNN` | 0001–9999 | `STORY-0042`    |
| Task       | `TASK-NNNN`  | 0001–9999 | `TASK-0117`     |
| Test Plan  | `TEST-NNNN`  | 0001–9999 | `TEST-0058`     |

Numbers are zero-padded to the full width (`STORY-0042`, not `STORY-42`).

## Filenames

`<ID>-<slug>.md`

Examples:
- `EPIC-03-persistence-and-storage.md`
- `STORY-0042-classifier-middleware.md`
- `TASK-0117-implement-encode-key.md`
- `TEST-0058-bucket-crud-e2e.md`

## Slug rules

- Kebab-case (`lower-case-with-hyphens`).
- ASCII only — strip diacritics, no Unicode.
- ≤ 60 characters.
- Start with a letter. No leading/trailing hyphens. No double hyphens.
- Slugs describe the artifact, not its status (e.g. `implement-encode-key`,
  not `done-encode-key`).

## ID range partition (for parallel generation)

When Stage 2 generates Stories, Tasks, and Test Plans in parallel —
one agent per Epic — each agent reserves a disjoint ID range to
prevent collisions. The reservations below are authoritative; agents
must not allocate outside their range.

| Epic     | Story range          | Task range           | Test range           |
|----------|----------------------|----------------------|----------------------|
| EPIC-01  | STORY-0001..0099     | TASK-0001..0299      | TEST-0001..0099      |
| EPIC-02  | STORY-0100..0199     | TASK-0300..0599      | TEST-0100..0199      |
| EPIC-03  | STORY-0200..0299     | TASK-0600..0899      | TEST-0200..0299      |
| EPIC-04  | STORY-0300..0399     | TASK-0900..1199      | TEST-0300..0399      |
| EPIC-05  | STORY-0400..0499     | TASK-1200..1499      | TEST-0400..0499      |
| EPIC-06  | STORY-0500..0599     | TASK-1500..1799      | TEST-0500..0599      |
| EPIC-07  | STORY-0600..0699     | TASK-1800..2099      | TEST-0600..0699      |
| EPIC-08  | STORY-0700..0799     | TASK-2100..2399      | TEST-0700..0799      |
| EPIC-09  | STORY-0800..0899     | TASK-2400..2699      | TEST-0800..0899      |
| EPIC-10  | STORY-0900..0999     | TASK-2700..2999      | TEST-0900..0999      |
| EPIC-11  | STORY-1000..1099     | TASK-3000..3299      | TEST-1000..1099      |
| EPIC-12  | STORY-1100..1199     | TASK-3300..3599      | TEST-1100..1199      |

If an agent exhausts its range, stop and raise a gap — do not encroach.

## Referencing inside artifacts

- Inline: `[STORY-0042]`, `[TASK-0117]`, `[TEST-0058]`.
- Lists: `- [STORY-0042] Classifier middleware`.
- Front-matter fields (e.g. `epic: EPIC-03`, `story: STORY-0042`,
  `covers: [STORY-0042, TASK-0117]`) take bare IDs without brackets.

## Stability guarantees

- An ID, once allocated and committed, is permanent.
- Deleting an artifact tombstones the ID; do not reuse.
- Renaming a slug is allowed; the ID does not change.
- Cross-references break loudly if a target is removed — fix the
  reference, do not reissue the ID.
