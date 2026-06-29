# Templates

Every PM artifact in `docs/pm/` follows one of the four templates below.
Copy verbatim when creating a new artifact.

---

## Epic template

```markdown
---
id: EPIC-NN
title: <short title>
status: backlog | ready | in_progress | review | done | blocked
whitepaper_section: "§N"
owner_area: backend | s3 | persistence | streaming | frontend | delivery
---

## Objective
<one paragraph: what this Epic delivers, in product terms>

## Scope
- In scope:
  - <bullet>
- Out of scope:
  - <bullet>

## Success criteria
- <measurable outcome>

## Stories
- [STORY-NNNN] <title>
- [STORY-NNNN] <title>

## Dependencies
- Blocks: [EPIC-NN]
- Blocked by: [EPIC-NN]

## References
- `docs/WHITEPAPER.md` §N (lines a–b)
```

---

## Story template

```markdown
---
id: STORY-NNNN
title: <short title>
epic: EPIC-NN
status: backlog | ready | in_progress | review | done | blocked
size: XS | S | M | L | XL
risk: low | medium | high
---

## User story
As a <role>, I want <capability>, so that <value>.
(Use "developer", "operator", or "S3 client" as roles for infra stories.)

## Description
<2–5 sentences. What this Story produces.>

## Acceptance criteria
- [ ] <verifiable statement>
- [ ] <verifiable statement>

## Tasks
- [TASK-NNNN] <title>
- [TASK-NNNN] <title>

## Test plan
- [TEST-NNNN] <title>

## Dependencies
- Blocks: [STORY-NNNN]
- Blocked by: [STORY-NNNN]

## References
- `docs/WHITEPAPER.md` §N.M (lines a–b)
- Interfaces consumed: <symbol, defined in STORY-NNNN>
- Interfaces produced: <symbol>
```

---

## Task template

```markdown
---
id: TASK-NNNN
title: <imperative verb phrase>
story: STORY-NNNN
status: backlog | ready | in_progress | review | done | blocked
type: implementation | refactor | infra | docs | spike
size: XS | S | M | L
---

## Description
<what this Task does, ≤ 5 sentences>

## Files to create / modify
- `apps/backend/src/.../foo.ts` — new
- `apps/backend/src/.../bar.module.ts` — modify (add provider)

## Implementation notes
<bullets. Include the specific code-sample reference from the white
paper that this Task realizes. Quote function signatures and key
constants verbatim from the white paper, not paraphrased.>

## Acceptance criteria
- [ ] <verifiable statement, e.g. "running `nx test backend --testPathPattern=foo.spec.ts` passes">
- [ ] <e.g. "OpenAPI export contains the new route">

## Test obligations
- Unit: covered by [TEST-NNNN]
- E2E: covered by [TEST-NNNN] (or "N/A — pure infra")
- Conformance: covered by [TEST-NNNN] (or "N/A")

## Dependencies
- Blocked by: [TASK-NNNN], [STORY-NNNN]

## References
- `docs/WHITEPAPER.md` §N.M (lines a–b)
- Related ADR / external doc: <link if any>
```

---

## Test Plan template

```markdown
---
id: TEST-NNNN
title: <what is being verified>
covers: [STORY-NNNN, TASK-NNNN, ...]
status: backlog | ready | in_progress | review | done | blocked
level: unit | e2e | conformance
---

## Goal
<what behavior we verify>

## Setup
<fixtures, env, containers>

## Cases
1. <given / when / then>
2. <given / when / then>

## Tooling
- Framework: jest | supertest | aws-cli | mc | s3cmd | @aws-sdk/client-s3
- Runner: `nx test backend` / `nx e2e backend-e2e` / `nx run conformance:run`

## Pass criteria
- [ ] <criterion>

## References
- `docs/WHITEPAPER.md` §N.M (lines a–b)
```
