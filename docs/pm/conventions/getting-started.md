# Getting started — Day 1

This is the concrete first-day walkthrough. It assumes you have just
finished generating the PM tree and every artifact is `backlog`. Read
[`workflow.md`](./workflow.md) for the underlying state machine
before you start.

---

## TL;DR loop

```
                ┌──────────────────────────────────────────┐
                │                                          │
                ▼                                          │
   ./scripts/pm-status.sh                                  │
        │                                                  │
        ▼                                                  │
   "Next up" → open the Story                              │
        │                                                  │
        ▼                                                  │
   Refine: backlog → ready                                 │
        │                                                  │
        ▼                                                  │
   Pick first Task: ready → in_progress                    │
        │                                                  │
        ▼                                                  │
   Implement; run Test Plan(s)                             │
        │                                                  │
        ▼                                                  │
   Task → review → done   ────────────► all Story tasks done?
        │                                                  │
        │                                                  ▼
        │                                       Story → review → done
        │                                                  │
        └──────────────────────────────────────────────────┘
```

The loop is: **status-check → refine → implement → mark done → repeat**.

---

## Step 0 — orient

Refresh the dashboard once:

```bash
./scripts/pm-status.sh
cat docs/pm/STATUS.md
```

On the very first run you'll see:

- All artifacts `backlog`.
- "Next up" reports _no Story is currently ready_.
- Milestone progress at 0% across the board.

This is the expected starting state. Nothing is `ready` yet because
no Story has been refined.

---

## Step 1 — start from the top of the backlog

Open [`../BACKLOG.md`](../BACKLOG.md). The first entry is the
starting point:

> 1. STORY-0001 — Scaffold backend Nx app and directory layout — EPIC-01 — S

The BACKLOG is in topological order: cross-Epic and intra-Epic
dependencies are respected. You can pick the next `ready` Story by
going top-to-bottom and taking the first one whose status is `ready`.

---

## Step 2 — refine: `backlog` → `ready`

Open the Story file (`docs/pm/stories/STORY-0001-*.md`). Run through
the refinement checklist from
[`workflow.md`](./workflow.md#refinement-checklist-backlog--ready):

- [ ] User-story sentence is unambiguous.
- [ ] Acceptance criteria are testable.
- [ ] At least one Test Plan ID is attached.
- [ ] All `blocked_by` targets are `done` or in a higher state.
- [ ] All Tasks under it are at least `ready`.

If anything is missing, tighten it now — edit the Story file
directly. When the checklist is green:

1. Edit the Story file's front matter: `status: backlog` → `status: ready`.
2. Edit every Task file under the Story the same way. (Tasks must be
   `ready` for the Story to be `ready`.)
3. Re-run `./scripts/pm-status.sh` and confirm the Story now appears
   under "Next up".

---

## Step 3 — claim: `ready` → `in_progress`

Pick the first Task under the Story. Open its file. Confirm:

- `Files to create / modify` lists concrete paths.
- `Implementation notes` quote the white-paper signature or constant
  being realized.
- Acceptance criteria are verifiable from a command line.

Flip the Task: `status: ready` → `status: in_progress`. Once the
first Task is `in_progress`, also flip the parent Story to
`in_progress`.

(Optional but recommended) Open a git branch named after the Story:

```bash
git checkout -b story-0001-scaffold-backend
```

---

## Step 4 — implement

Do the work described in the Task. The Task body names every file to
touch and quotes the white paper. If your implementation drifts from
the spec, update the Task file with a note explaining why before
committing.

When the Task's acceptance criteria are met:

1. Run any Test Plan IDs attached to the parent Story
   ([`docs/pm/test-plans/TEST-NNNN-*.md`](../test-plans/)) — at this
   stage usually a unit Test Plan.
2. Flip the Task: `status: in_progress` → `status: review`.
3. Open a PR or commit the change. Reference the Task ID in the
   commit message (`TASK-0001: scaffold Nx workspace`).

After review/merge: flip the Task to `status: done`.

---

## Step 5 — close the Story

When **all** the Story's Tasks are `done` **and all** its Test Plans
are passing:

1. Confirm the Story's acceptance criteria, end-to-end.
2. Flip the Story file: `status: review` → `status: done`.

Re-run `./scripts/pm-status.sh`. The milestone progress bar advances.

---

## Step 6 — repeat

Go back to Step 1. The next `ready` Story is your next target. If
nothing is `ready` yet, refine the next `backlog` Story in BACKLOG
order.

If you need to refine several Stories ahead of time so a team can
pull work in parallel, do a **refinement pass** before any
implementation: walk the BACKLOG top-to-bottom and refine N Stories
to `ready` without doing the work yet. Keep N small (≤ 5) so the
"ready queue" doesn't outrun reality.

---

## Common questions

**Q. Can I work on a Task without flipping its parent Story to `in_progress`?**
No. The Story's status is the aggregate signal. If you're working on
one of its Tasks, the Story is `in_progress`.

**Q. What if a Task turns out to be larger than expected?**
Split it. Allocate a new Task ID in the same Epic's reserved range
(see [`ids.md`](./ids.md)), file the new Task, link it from the parent
Story, and mark the old Task `done` or `deleted` (per the workflow
rules).

**Q. What if I find a contradiction in the white paper while implementing?**
File a Task of type `spike` under the relevant Story, status
`blocked`, with the contradiction described. Do not silently
diverge from the white paper.

**Q. How do I find what's blocked right now?**

```bash
grep -l '^status: blocked' docs/pm/stories/*.md docs/pm/tasks/*.md
```

Or just read the "Blocked" section in
[`../STATUS.md`](../STATUS.md).

**Q. The dashboard is wrong / stale.**
Re-run `./scripts/pm-status.sh`. It rebuilds STATUS.md from the
current artifact tree every time.

**Q. Should commits map 1:1 to Tasks or to Stories?**
Loose rule: one commit per Task during work, one PR per Story for
review. PR description links the Story ID; commit messages link
Task IDs.

---

## Useful one-liners

```bash
# Next ready Story (matches "Next up" in STATUS.md):
grep -l '^status: ready' docs/pm/stories/*.md | sort | head -1

# All in-progress Stories and Tasks:
grep -lE '^status:[[:space:]]+in_progress' docs/pm/{stories,tasks}/*.md

# All blocked artifacts:
grep -lE '^status:[[:space:]]+blocked' docs/pm/{stories,tasks,test-plans}/*.md

# Status counts across all Stories:
grep -h '^status:' docs/pm/stories/*.md | sort | uniq -c

# All Tasks belonging to one Story (e.g. STORY-0001):
grep -l '^story: STORY-0001$' docs/pm/tasks/*.md

# All Test Plans covering one Story:
grep -l 'STORY-0001' docs/pm/test-plans/*.md
```
