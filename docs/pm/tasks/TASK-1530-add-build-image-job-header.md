---
id: TASK-1530
title: Add `build-image` job header, runner, needs, and permissions
story: STORY-0503
status: review
type: infra
size: XS
---

## Description
Append the `build-image` job header to `ci.yml`: runner `ubuntu-22.04`, dependency on `lint-and-test`, permissions to read contents and write packages, an `outputs.image-tag` wired to the `meta` step, and the buildx setup action.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append `jobs.build-image` skeleton)

## Implementation notes
- Verbatim header from white paper §5.19:

  ```yaml
  build-image:
    name: build docker image
    runs-on: ubuntu-22.04
    needs: lint-and-test
    permissions:
      contents: read
      packages: write
    outputs:
      image-tag: ${{ steps.meta.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      # meta, build, save, upload populated by downstream Tasks
  ```

- `permissions.packages: write` is forward-looking for an eventual `docker push` to GHCR; today the job does not push.

## Acceptance criteria
- [ ] Job ID `build-image` exists with the runner, `needs`, `permissions`, and `outputs` blocks above.
- [ ] `actions/checkout@v4` and `docker/setup-buildx-action@v3` are present and ordered first.

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1521]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8657–8668)
