---
id: TASK-1523
title: Verify `nrwl/nx-set-shas@v4` derives correct affected base on PRs
story: STORY-0502
status: blocked
type: spike
size: XS
---

## Description
Confirm that `nrwl/nx-set-shas@v4` correctly populates `NX_BASE` and `NX_HEAD` when run with `fetch-depth: 0` on both PR and push events, so `nx run-many --target=test --all` (the white-paper-specified command) and any future `nx affected` invocations resolve the right base SHA. This is a spike — pure validation, no code change unless we find drift from the white paper.

## Files to create / modify
- _No source changes expected. If a corrective step is required (e.g., explicit `git fetch origin main`), record the diff against §5.19 in this Task body before resolving._

## Implementation notes
- The white paper uses `nx run-many --target=test --all` (full-graph), not `nx affected`, so a missing affected base is non-fatal for the gate today — but the action is still required if/when downstream Stories switch to affected runs.
- Open a draft PR in a sandbox repo to inspect `nrwl/nx-set-shas` output; capture the resolved SHAs into the spike's body.

## Acceptance criteria
- [ ] `nrwl/nx-set-shas@v4` succeeds on at least one PR run and one push-to-main run with the workflow from [TASK-1521].
- [ ] If the action requires extra steps (e.g., `actions/checkout` with `fetch-depth: 0` confirmed) those are reflected in the workflow as authored.
- [ ] Findings recorded in the Task body before the Task moves to `done`.

## Test obligations
- Unit: N/A — spike.
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1521]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8620–8627)
- External: <https://github.com/nrwl/nx-set-shas>

## Blocked by
- Spike: open until a sandbox run confirms behavior or surfaces a delta.
- Recorded: 2026-05-20
