---
id: TASK-1532
title: Wire `docker/build-push-action@v6` with GHA layer cache
story: STORY-0503
status: review
type: infra
size: XS
---

## Description
Add the `Build` step using `docker/build-push-action@v6` against the repo-root `Dockerfile`: `push: false, load: true`, tags as `openbucket:<image-tag>`, with `cache-from: type=gha` and `cache-to: type=gha,mode=max` so subsequent runs reuse layers.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append the `Build` step inside `build-image`)

## Implementation notes
- Verbatim step from white paper §5.19:

  ```yaml
  - name: Build
    uses: docker/build-push-action@v6
    with:
      context: .
      file: Dockerfile
      push: false
      load: true
      tags: openbucket:${{ steps.meta.outputs.tag }}
      cache-from: type=gha
      cache-to: type=gha,mode=max
  ```

- `load: true` loads the built image into the local Docker daemon so the next `docker save` step can find it.
- `cache-to: type=gha,mode=max` caches all layers including intermediates.

## Acceptance criteria
- [ ] `docker/build-push-action@v6` runs with `context: .`, `file: Dockerfile`, `push: false`, `load: true`.
- [ ] The image is tagged `openbucket:${{ steps.meta.outputs.tag }}`.
- [ ] Both `cache-from` and `cache-to` reference `type=gha` (mode=max on the latter).
- [ ] On a second run with no source change, the build is mostly a cache hit (verified by job log).

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: covered downstream by [TEST-0502].

## Dependencies
- Blocked by: [TASK-1531], [STORY-0501]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8679–8688)
