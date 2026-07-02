# Agent workflow — how to ship a change in this repo

A practical playbook for an AI agent (or any contributor) making a feature, fix,
or chore in OpenBucket: branch → implement → verify → PR → wait for checks →
merge → (optionally) release. It encodes the conventions this repo actually uses;
follow it end-to-end rather than improvising per task.

> **Golden rules**
> 1. **Verify before you claim.** Run the real tests/build; don't assert "green"
>    from inspection. Report failures with their output.
> 2. **Branch first.** Never commit feature/fix work directly to `main` (release
>    version-bumps are the one documented exception — see [Releasing](#5-releasing--versioning)).
> 3. **Pause before anything irreversible or outward-facing** — publishing to npm,
>    pushing a release tag, deleting data. Get explicit human go-ahead.
> 4. **Don't rewrite history.** `docs/pm/**` (epics/stories/tasks/test-plans) is an
>    immutable, timestamped record. Leave it as-is unless explicitly asked.

---

## 0. Prerequisites (once per environment)

- **Node 22** — the whole stack runs on one version, pinned in [`.nvmrc`](../.nvmrc).
  `nvm use` (or `fnm use`), then `npm ci`.
- **`gh` authenticated** with `repo` + `workflow` scopes: `gh auth status`.
- **Git pushes use `gh`'s token.** Run `gh auth setup-git` once. This matters:
  any commit that touches `.github/workflows/**` is **rejected** unless the
  pushing credential has `workflow` scope. If a push fails with
  _"refusing to allow a Personal Access Token to create or update workflow …"_,
  `gh auth setup-git` is the fix.

This is an **Nx monorepo**. Key projects: `nestjs` (the publishable library —
the real product), `openbucket-backend` (standalone deploy shell),
`openbucket-frontend` (Angular admin SPA), `openbucket-backend-e2e`,
`conformance`, `docs`.

---

## 1. Branch

Cut a branch off `main`. Use a Conventional-Commits-style prefix matching the work:

```bash
git checkout main && git pull --ff-only
git checkout -b fix/short-slug      # or feat/… , chore/… , docs/… , test/…
```

Naming: `<type>/<kebab-slug>`, e.g. `fix/libsql-driver-swap`,
`feat/bucket-replication`, `chore/deps-bump`.

---

## 2. Implement + verify locally

Make the change, then **exercise it** — the layer you touched plus anything
downstream. Don't stop at a typecheck.

```bash
# Unit tests for the library (fast; also typechecks via ts-jest)
npx nx test nestjs
# …or a focused subset while iterating:
CI=1 npx jest --config libs/nestjs/jest.config.ts <path-or-pattern> --no-colors

# Lint (one project, or everything)
npx nx lint nestjs
npx nx run-many -t lint

# Typecheck / build the library and the standalone backend bundle
npx nx build nestjs
npx nx build openbucket-backend        # webpack bundle; native deps stay external

# End-to-end (spawns the built backend against a real SQLite DB)
npx nx e2e openbucket-backend-e2e

# Fault-injection / durability suite — REQUIRES the backend to be built first
npx nx build openbucket-backend
node tests/fault/run-all.mjs           # exit code = guarantee violations (0 = all held)

# S3 protocol conformance
npx nx e2e conformance                 # (matches the CI "s3 conformance suite" check)
```

Which of these to run scales with blast radius: a persistence/storage change
warrants the fault suite + e2e; a frontend-only change does not. When in doubt,
run what CI runs (below) so there are no surprises on the PR.

**Persistence gotcha:** all `@mikro-orm/*` packages must be the **exact same
version** as `@mikro-orm/core` (MikroORM enforces this at runtime). If you add or
bump a MikroORM package, pin it to core's version or every DB test fails with
_"Bad @mikro-orm/… version"_.

---

## 3. Commit

Conventional Commits, imperative subject, scope where useful. Explain **why** in
the body for non-trivial changes. End every commit with the trailer:

```
<type>(<scope>): <summary>

<why + what, wrapped ~72 cols>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

Types seen in history: `feat`, `fix`, `chore`, `docs`, `test`, `ci`, `refactor`.
Keep commits coherent; it's fine to split a functional change from a docs sweep.

---

## 4. Push, open a PR, wait for checks

```bash
git push -u origin <branch>
gh pr create --base main --head <branch> --title "<type>(<scope>): <summary>" --body "<what/why/verification>"
```

A good PR body states the problem, the change, and **how it was verified** (paste
the test/suite results). End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**Then wait for CI — do not merge on a pending or red status.** `ci.yml` runs on
every PR to `main`. Its checks:

| Check | What it guards |
|---|---|
| `lint + unit` | lint + the nestjs unit suite |
| `backend e2e (real sqlite)` | the app spawned against a real DB |
| `s3 conformance suite` | S3 wire-protocol compatibility |
| `build docker image` | the standalone image builds (native bindings resolve in the runtime base) — the long pole, ~6 min |
| `CodeQL` / `Analyze` | security static analysis |

```bash
gh pr checks <N> --watch --interval 25    # blocks until all checks resolve; nonzero exit if any fail
gh pr view <N> --json mergeable,mergeStateStatus,reviewDecision
```

If a check fails: `gh run view <run-id> --log-failed` (or `gh pr checks <N>` for
the job URL), fix on the same branch, push, let CI re-run. Don't merge around a
failure.

---

## 5. Merge

This repo uses **squash merges** — one commit on `main` per PR, titled with the
PR summary and `(#N)`:

```bash
gh pr merge <N> --squash --delete-branch --subject "<type>(<scope>): <summary> (#N)"
git checkout main && git pull --ff-only
```

Merge only when: checks are green **and** the change is approved / you have the
human's go-ahead. Merging is outward-facing — treat it as a checkpoint, not a
default.

---

## 6. Releasing & versioning

OpenBucket ships two artifacts, each on its **own tag scheme**. Releases are
**tag-triggered** — pushing the tag is what publishes.

| Artifact | Tag | Workflow | Destination |
|---|---|---|---|
| `@openbucket/nestjs` (npm library) | `nestjs-v<version>` | `release-nestjs` | npm — `next` dist-tag for pre-releases (version contains `-`), else `latest` |
| Standalone server image | `v<version>` | `release-docker` (+ re-runs `ci`) | GHCR `ghcr.io/projectbay/openbucket` |

**Versioning = SemVer.** Pre-1.0, minors may break. Pre-release suffixes
(`-alpha.N`, `-beta.N`) publish to npm's **`next`** tag so
`npm i @openbucket/nestjs` keeps resolving to the latest **stable** release;
consumers opt into pre-releases with `@next` or an exact version.

### Releasing the npm library (`@openbucket/nestjs`)

1. **On `main`** (the one place a direct commit is the convention — prior release
   commits have no `#N`), bump and finalize in a single `chore(release):` commit:
   - `libs/nestjs/package.json` → new version.
   - `apps/openbucket-backend/package.json` → align the `@openbucket/nestjs` pin
     to the **exact** new version (the backend workspace pins it exactly, so it
     must move in lockstep).
   - `npm install` to relock `package-lock.json`.
   - `CHANGELOG.md` → promote `[Unreleased]` to `[<version>] — <date>`, add a fresh
     empty `[Unreleased]`, and update the compare links at the bottom.
2. **Let `ci.yml` go green on that release commit.** The `release-nestjs` publish
   gate deliberately does **not** re-run the unit suite (only lint + a clean
   lib/SPA build), so **green `ci.yml` on the exact commit you tag is the real
   quality gate.**
3. **Get explicit human go-ahead** (publishing is irreversible), then tag & push:
   ```bash
   git tag nestjs-v<version> <commit>
   git push origin nestjs-v<version>
   ```
   `release-nestjs` verifies the tag matches `libs/nestjs/package.json`, builds the
   lib + bundles the admin SPA, and `npm publish`es to the right dist-tag.
4. Verify: `npm view @openbucket/nestjs dist-tags`, and (for a real check) install
   it in a clean consumer under the target package manager / Node version.

### Releasing the Docker image

Tag `v<version>` and push — `release-docker` builds multi-arch (amd64+arm64) and
pushes to GHCR. Note a `v*` tag **also** triggers `ci.yml`.

### Docs site

`deploy-docs` publishes the Docusaurus site to GitHub Pages automatically on any
push to `main` under `apps/docs/**`. No tag needed.

---

## 7. Agent-specific guardrails

- **Ground every factual claim in a command's output**, not memory — versions,
  test results, file contents, whether a check passed.
- **Pause points that require explicit human confirmation:** pushing a release
  tag / `npm publish`, merging, force-pushing, deleting branches/data, anything
  that contacts an external service irreversibly.
- **Anthropic/Claude specifics:** the current Claude models are the Claude 5
  family, Opus 4.8, and Haiku 4.5 — don't hardcode older model IDs in examples.
- **Keep the change set honest:** no stray temp files (use the scratchpad),
  `tmp/` is gitignored, and confirm `git status` shows only intended files before
  committing.
- **Leave the historical record alone:** `docs/pm/**` documents what was planned
  and built at the time; updating it falsifies the trace. The three whitepaper
  copies (`docs/WHITEPAPER.md`, `docs/whitepaper/*`, `apps/docs/docs/whitepaper/*`),
  by contrast, are living docs and should be kept consistent with the code.

---

## Quick reference — the happy path

```bash
git checkout -b fix/thing main
# …implement…
npx nx test nestjs && npx nx lint nestjs && npx nx build openbucket-backend
node tests/fault/run-all.mjs                        # if persistence/storage touched
git commit -am "fix(scope): thing"                  # + Co-Authored-By trailer
git push -u origin fix/thing
gh pr create --base main --title "fix(scope): thing (#…)" --body "…"
gh pr checks <N> --watch                            # wait for green
gh pr merge <N> --squash --delete-branch
# Release (npm lib), only with go-ahead:
#   bump versions on main → commit → wait for ci green → tag nestjs-v<version> → push tag
```
