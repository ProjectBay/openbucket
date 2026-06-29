---
id: TASK-1545
title: Add the `conformance` GitHub Actions job
story: STORY-0504
status: review
type: infra
size: S
---

## Description
Append the `conformance` job to `.github/workflows/ci.yml`: gated to PRs and tag pushes, runs on `ubuntu-22.04` after `build-image`, installs the client matrix (`awscli`, `s3cmd`, `mc`), downloads the `docker-image` artifact, loads it, runs `npm ci`, and invokes `nx run conformance:e2e --ci` with `OPENBUCKET_IMAGE` set.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append `jobs.conformance`)

## Implementation notes
- Verbatim job from white paper §5.19:

  ```yaml
  conformance:
    name: s3 conformance suite
    if: github.event_name == 'pull_request' || startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-22.04
    needs: build-image
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Install client matrix
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends awscli s3cmd
          curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
          chmod +x /usr/local/bin/mc

      - uses: actions/download-artifact@v4
        with:
          name: docker-image
          path: /tmp

      - name: Load image
        run: docker load -i /tmp/openbucket.tar

      - run: npm ci --no-audit --no-fund

      - name: Run conformance suite
        env:
          OPENBUCKET_IMAGE: openbucket:${{ needs.build-image.outputs.image-tag }}
        run: npx nx run conformance:e2e --ci
  ```

- White paper §5.19 closing note: the `conformance` job is gated to PRs to `main` and to tag pushes so day-to-day pushes pay only the cheap `lint+test+e2e+build-image` chain.
- The `if:` guard relies on `github.event_name == 'pull_request'` (any PR base, but the workflow trigger is already scoped to `main`) and `startsWith(github.ref, 'refs/tags/')`.

## Acceptance criteria
- [ ] Job ID `conformance` exists with the `if:` guard above.
- [ ] `needs: build-image` is set so the artifact is available.
- [ ] The install-client-matrix step is byte-equal to the white paper.
- [ ] `OPENBUCKET_IMAGE` is set from `needs.build-image.outputs.image-tag`.
- [ ] On a PR run, the job actually runs and the matrix is executed.

## Test obligations
- Unit: N/A — infra.
- E2E: N/A.
- Conformance: covered by [TEST-0502].

## Dependencies
- Blocked by: [TASK-1533], [TASK-1540], [TASK-1541], [TASK-1542], [TASK-1543], [TASK-1544]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8699–8734)
