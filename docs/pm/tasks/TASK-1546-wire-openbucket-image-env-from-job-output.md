---
id: TASK-1546
title: Wire `OPENBUCKET_IMAGE` plumbing from the build-image job output
story: STORY-0504
status: review
type: infra
size: XS
---

## Description
Confirm and document the cross-job data flow: `build-image.outputs.image-tag` (set by [TASK-1531]) is consumed by the `conformance` job as `OPENBUCKET_IMAGE: openbucket:${{ needs.build-image.outputs.image-tag }}` (set by [TASK-1545]); inside the conformance suite, `process.env.OPENBUCKET_IMAGE` selects the image the `testcontainers` `GenericContainer` boots ([TASK-1541]).

## Files to create / modify
- _No new files; this Task validates the wiring already authored in [TASK-1531], [TASK-1541], and [TASK-1545]._

## Implementation notes
- The chain, verbatim from §5.19 / §5.20.3:
  - Producer (TASK-1531): `echo "tag=…" >> "$GITHUB_OUTPUT"` inside step `meta`; job exposes `outputs.image-tag: ${{ steps.meta.outputs.tag }}`.
  - Consumer (TASK-1545): `env: OPENBUCKET_IMAGE: openbucket:${{ needs.build-image.outputs.image-tag }}`.
  - Reader (TASK-1541): `new GenericContainer(process.env.OPENBUCKET_IMAGE ?? 'openbucket:local')`.
- Verify by triggering a PR run and inspecting the conformance job's expanded env block (`echo "$OPENBUCKET_IMAGE"` debug step OK to add temporarily).

## Acceptance criteria
- [ ] On a PR run, the `conformance` job log shows `OPENBUCKET_IMAGE=openbucket:pr-<num>-<sha7>`.
- [ ] The conformance suite reports it loaded the same image the `build-image` job built (compare digests if needed).

## Test obligations
- Unit: N/A — wiring validation.
- E2E: N/A.
- Conformance: implicit in [TEST-0502].

## Dependencies
- Blocked by: [TASK-1531], [TASK-1541], [TASK-1545]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8664–8665, 8729–8731), §5.20.3 (lines 8892–8893)
