---
id: TASK-1522
title: Wire the `e2e` CI job
story: STORY-0502
status: review
type: infra
size: S
---

## Description
Add the `e2e` job to `.github/workflows/ci.yml`: depends on `lint-and-test`, checks out, sets up Node 22, runs `npm ci`, prepares a `tmp/e2e-data` directory, exports the required env, and runs `nx run backend-e2e:e2e --ci`.

## Files to create / modify
- `.github/workflows/ci.yml` — modify (append `jobs.e2e`)

## Implementation notes
- Verbatim job from white paper §5.19:

  ```yaml
  e2e:
    name: backend e2e (real sqlite)
    runs-on: ubuntu-22.04
    needs: lint-and-test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci --no-audit --no-fund
      - name: Prepare tmp data dir
        run: mkdir -p tmp/e2e-data
      - name: Run e2e
        env:
          DATA_DIR: ${{ github.workspace }}/tmp/e2e-data
          JWT_SECRET: test-secret-not-for-prod-not-for-prod
        run: npx nx run backend-e2e:e2e --ci
  ```

- The `DATA_DIR` lives under `${{ github.workspace }}/tmp/e2e-data` so SQLite + blob writes go to a writable, ephemeral location.
- `JWT_SECRET=test-secret-not-for-prod-not-for-prod` is a fixed sentinel — never reused outside CI.

## Acceptance criteria
- [ ] Job ID is `e2e`, runs on `ubuntu-22.04`, has `needs: lint-and-test`.
- [ ] `DATA_DIR` env is `${{ github.workspace }}/tmp/e2e-data` and `JWT_SECRET` is the test sentinel.
- [ ] The job invokes `npx nx run backend-e2e:e2e --ci`.

## Test obligations
- Unit: N/A — infra.
- E2E: the job itself runs the e2e suite; coverage of individual scenarios is owned by other Epics' Test Plans.
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1520]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8638–8656)
