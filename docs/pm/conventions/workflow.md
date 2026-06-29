# Status workflow

Every artifact has a `status` field in its front matter. The status
moves through a fixed set of states with the transitions below.

## States

| Status        | Meaning                                                                          |
|---------------|----------------------------------------------------------------------------------|
| `backlog`     | Recorded but not yet refined. Default for newly-generated artifacts.             |
| `ready`       | Refined: acceptance criteria explicit, dependencies satisfied, ready to pick up. |
| `in_progress` | Someone is actively working on it.                                               |
| `review`      | Work complete; awaiting code review / acceptance / merge.                        |
| `done`        | Merged and verified against acceptance criteria.                                 |
| `blocked`     | Cannot progress until an external condition clears. Reason recorded in the body. |

## Transitions

```
backlog ─▶ ready ─▶ in_progress ─▶ review ─▶ done
                       │              │
                       └──────┬───────┘
                              ▼
                          blocked  ◀── from any state
                              │
                              └──▶ back to prior state when unblocked
```

Permitted moves:

- `backlog` → `ready` (after refinement: AC clarified, deps resolved)
- `ready` → `in_progress` (when someone claims it)
- `in_progress` → `review` (work submitted for review)
- `review` → `done` (accepted)
- `review` → `in_progress` (changes requested)
- *any* → `blocked` (record blocker in artifact body)
- `blocked` → previous state (when blocker clears)

`backlog` → `in_progress` is not permitted: refinement must happen
first, even if briefly. If you skip refinement you will skip
acceptance criteria, and the Task will land unverifiable.

## Aggregation

A parent inherits a derived status from its children, surfaced only
in `docs/pm/README.md` summary counts:

- An Epic is **done** when all its Stories are done.
- A Story is **done** when all its Tasks are done **and** all its
  Test Plans are done.
- A Story is **blocked** if any child Task is blocked.

Children may be `in_progress` while the parent is still `ready` — the
parent's status only flips to `in_progress` when the human/agent
claims work coordinated at that level.

## Blockers

When moving to `blocked`, append a section to the artifact body:

```markdown
## Blocked by
- <one-line reason>
- Related artifacts: [TASK-NNNN], [STORY-NNNN]
- External: <link or ticket ID>
- Recorded: <ISO-8601 date>
```

When unblocked, remove the section (do not just clear it) and move the
status back to its prior state.

## Refinement checklist (backlog → ready)

A Story is ready when:

- [ ] User-story sentence is unambiguous.
- [ ] Acceptance criteria are testable.
- [ ] At least one Test Plan ID is attached.
- [ ] All `blocked_by` targets are `done` or in a higher state than
      this Story.
- [ ] All Tasks under it are at least `ready`.

A Task is ready when:

- [ ] `Files to create / modify` lists concrete paths.
- [ ] `Implementation notes` quotes the white-paper signature or
      constant being realized.
- [ ] Acceptance criteria are verifiable from a command line.
- [ ] All `blocked_by` Tasks are `done` or `review`.
