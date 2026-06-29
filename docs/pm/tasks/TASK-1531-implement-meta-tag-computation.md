---
id: TASK-1531
title: Implement the `meta` tag-computation step
story: STORY-0503
status: review
type: infra
size: XS
---

## Description
Add the `meta` step to the `build-image` job: writes `tag=pr-<pr-num>-<sha7>` for `pull_request` events and `tag=main-<sha7>` for `push` events to `$GITHUB_OUTPUT`, so the downstream build and conformance jobs reference a deterministic image tag.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append `meta` step inside `build-image`)

## Implementation notes
- Verbatim step from white paper §5.19:

  ```yaml
  - id: meta
    name: Compute image tag
    run: |
      if [ "${{ github.event_name }}" = "pull_request" ]; then
        echo "tag=pr-${{ github.event.pull_request.number }}-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      else
        echo "tag=main-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      fi
  ```

- The `meta` step ID is what `outputs.image-tag: ${{ steps.meta.outputs.tag }}` references at the job level.
- `${GITHUB_SHA::7}` is bash substring; safe on the `ubuntu-22.04` runner default shell.

## Acceptance criteria
- [ ] The step ID is `meta` and writes a single `tag=…` line to `$GITHUB_OUTPUT`.
- [ ] On a PR, the tag matches `^pr-\d+-[0-9a-f]{7}$`.
- [ ] On a push to `main`, the tag matches `^main-[0-9a-f]{7}$`.

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1530]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8670–8677)
