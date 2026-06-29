---
id: TASK-1533
title: Save image to tar and upload as `docker-image` artifact
story: STORY-0503
status: review
type: infra
size: XS
---

## Description
Add the `Save image` and `upload-artifact` steps to the `build-image` job: `docker save openbucket:<tag> -o /tmp/openbucket.tar`, then upload `/tmp/openbucket.tar` as artifact `docker-image` with `retention-days: 7`, so the conformance job can `docker load` the same image without rebuilding.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append save + upload steps inside `build-image`)

## Implementation notes
- Verbatim steps from white paper §5.19:

  ```yaml
  - name: Save image
    run: docker save openbucket:${{ steps.meta.outputs.tag }} -o /tmp/openbucket.tar

  - uses: actions/upload-artifact@v4
    with:
      name: docker-image
      path: /tmp/openbucket.tar
      retention-days: 7
  ```

- The artifact name `docker-image` is consumed by the conformance job — keep it exactly that.

## Acceptance criteria
- [ ] `docker save` writes `/tmp/openbucket.tar` for the tagged image.
- [ ] `actions/upload-artifact@v4` publishes `docker-image` with 7-day retention.
- [ ] On a successful PR run, the artifact is downloadable from the GH Actions UI.

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: covered downstream by [TEST-0502] (which consumes this artifact).

## Dependencies
- Blocked by: [TASK-1532]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8690–8697)
