---
id: TASK-1521
title: Wire the `lint-and-test` CI job
story: STORY-0502
status: review
type: infra
size: S
---

## Description
Add the `lint-and-test` job to `.github/workflows/ci.yml`: checkout with `fetch-depth: 0`, set up Node 22 with npm cache, install via `npm ci --no-audit --no-fund`, derive Nx affected base via `nrwl/nx-set-shas@v4`, run lint, unit tests with `--coverage`, the api-client freshness check, and upload `coverage/` as an artifact.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append `jobs.lint-and-test`)

## Implementation notes
- Verbatim job from white paper §5.19:

  ```yaml
  jobs:
    lint-and-test:
      name: lint + unit
      runs-on: ubuntu-22.04
      steps:
        - uses: actions/checkout@v4
          with: { fetch-depth: 0 }

        - uses: actions/setup-node@v4
          with:
            node-version: ${{ env.NODE_VERSION }}
            cache: npm

        - run: npm ci --no-audit --no-fund

        - name: Derive nx affected base
          uses: nrwl/nx-set-shas@v4

        - name: Lint
          run: npx nx run-many --target=lint --all --parallel=4

        - name: Unit tests
          run: npx nx run-many --target=test --all --parallel=4 --ci --coverage

        - name: api-client freshness check
          run: npx nx run api-client:check

        - uses: actions/upload-artifact@v4
          if: always()
          with:
            name: coverage
            path: coverage/
  ```

- `fetch-depth: 0` is required by `nrwl/nx-set-shas` to compute affected base across history.
- Job name in the GH UI: `lint + unit`. Job ID: `lint-and-test`.

## Acceptance criteria
- [ ] Job ID is `lint-and-test`, runs on `ubuntu-22.04`.
- [ ] All steps appear in the order above with the exact commands.
- [ ] Lint, unit tests, and api-client freshness check are all gating (any failure red).
- [ ] Coverage artifact is uploaded `if: always()`.

## Test obligations
- Unit: N/A — infra; freshness check covered by [TEST-0500].
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1520]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8606–8636)
