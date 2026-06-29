---
id: TASK-1520
title: Create `.github/workflows/ci.yml` skeleton with triggers, env, and concurrency
story: STORY-0502
status: review
type: infra
size: XS
---

## Description
Create the `ci.yml` workflow file with the top-level structure: `name: ci`, triggers on push to `main` and PRs targeting `main`, a `concurrency` block that cancels stale runs per ref, and the `NODE_VERSION` env var.

## Files to create / modify
- `.github/workflows/ci.yml` — new

## Implementation notes
- Verbatim header from white paper §5.19:

  ```yaml
  # .github/workflows/ci.yml
  name: ci

  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]

  concurrency:
    group: ci-${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: true

  env:
    NODE_VERSION: '22'

  jobs:
    # filled in by TASK-1521 (lint-and-test) and TASK-1522 (e2e)
  ```

## Acceptance criteria
- [ ] `.github/workflows/ci.yml` parses as valid GitHub Actions YAML.
- [ ] The header (name, on, concurrency, env) is byte-equal to the white paper.
- [ ] `jobs:` exists (jobs themselves filled by downstream Tasks).

## Test obligations
- Unit: N/A — infra.
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8588–8605)
