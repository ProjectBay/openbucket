---
sidebar_position: 6
title: Contributing
description: How to contribute to OpenBucket — local dev setup, the Node 22 toolchain, the Nx monorepo workflow, tests, and the pull-request process.
---

# Contributing to OpenBucket

Thanks for your interest in improving OpenBucket! This guide covers the dev
setup, the Node requirements, and the workflow for changes.

By participating you agree to abide by our
[Code of Conduct](https://github.com/ProjectBay/openbucket/blob/main/CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js 22** (`>= 22.12`) — a single version runs the whole stack: the
  backend (NestJS + `libsql`) and the frontend (Angular). It matches
  what CI and the Docker image use and is pinned in `.nvmrc`:

  ```bash
  nvm install 22 && nvm use 22   # or, with fnm: fnm use
  npm ci
  ```

  > Earlier the backend needed Node 20 and the frontend Node 23 — that split is
  > **gone**. Node 22 satisfies both: Angular 21 requires `>= 22.12`, and the
  > SQLite driver (`libsql`) ships N-API prebuilds that are ABI-stable across
  > Node majors (so no native compile is needed, on any supported Node).

- A C/C++ toolchain is only required if a native-module **prebuilt isn't
  available** for your platform (`libsql`, `argon2`). On common platforms
  `npm ci` downloads prebuilts and **no compiler is needed**. If you do need to
  compile: `python3` + `make` + a compiler (`build-essential` on Debian/Ubuntu,
  Xcode CLT on macOS, or the Visual Studio "Desktop development with C++"
  workload on Windows).

## Setup

```bash
git clone https://github.com/ProjectBay/openbucket.git
cd openbucket
npm ci
```

## Common tasks

This is an [Nx](https://nx.dev) workspace; run targets with `nx <target> <project>`.

```bash
# --- Backend ---
nx serve openbucket-backend            # run the standalone app
nx build openbucket-backend            # webpack bundle → dist/apps/openbucket-backend
nx test  nestjs                        # unit tests for the library/backend
nx e2e   openbucket-backend-e2e        # end-to-end (spawns the built app)

# --- Frontend ---
nx serve openbucket-frontend           # Angular dev server (port 4200)
nx build openbucket-frontend           # production SPA build

# --- Docs site (this site) ---
nx serve docs                          # Docusaurus dev server
nx build docs                          # static build → apps/docs/build

# --- Everything ---
nx run-many -t lint                    # ESLint across all projects
nx run-many -t test                    # all unit suites
```

> The docs site (`apps/docs`) keeps its own dependencies outside the npm
> workspaces, so run `npm --prefix apps/docs ci` once before `nx serve docs` /
> `nx build docs`.

### Running a single test file

The repo uses **Jest 30**, whose flag is **plural**: `--testPathPatterns`
(the old singular `--testPathPattern` is silently ignored and runs everything).

```bash
nx test nestjs --testPathPatterns="spa.controller"
```

### Building the publishable library

`@openbucket/nestjs` bundles the admin SPA, so building it is two steps:

```bash
nx build openbucket-frontend           # build the SPA
nx bundle-spa nestjs                    # tsc build + copy SPA → dist/libs/nestjs/assets/spa
# publishable artifact is dist/libs/nestjs
```

Releases are automated: pushing a `nestjs-v<version>` tag triggers the release
workflow.

## Code style

- **Prettier** + **ESLint** are enforced; run `nx run-many -t lint` and
  `npx prettier --write .` before pushing. An `.editorconfig` keeps editors
  consistent (LF, UTF-8, 2-space indent).
- Match the surrounding code: comment density, naming, and idioms.
- TypeScript strictness is on — no `any` escape hatches in new code.

## Commit & PR workflow

1. **Branch** off `main` (`feat/…`, `fix/…`, `docs/…`).
2. Use **[Conventional Commits](https://www.conventionalcommits.org/)** for
   messages — e.g. `feat(admin-ui): add bucket object-lock editor`,
   `fix(s3): …`, `docs(pkg): …`, `test(pkg): …`. Scope by area.
3. Keep PRs focused. Add or update tests for behavior changes. Update docs /
   `CHANGELOG.md` (the **Unreleased** section) when relevant.
4. Open a PR against `main`. **CI must be green** — it's the functional gate.
5. A maintainer reviews and merges.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/ProjectBay/openbucket/issues/new/choose).
For **security vulnerabilities, do not open a public issue** — follow
[SECURITY.md](https://github.com/ProjectBay/openbucket/blob/main/SECURITY.md).

## Project layout

See [Architecture](./concepts/architecture.md) for the repository layout,
and the [Whitepaper](./whitepaper/01-backend-architecture.md) for the design in
depth.
