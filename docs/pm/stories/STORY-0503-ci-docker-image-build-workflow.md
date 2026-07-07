---
id: STORY-0503
title: CI Docker image build workflow
epic: EPIC-06
status: done
size: S
risk: medium
---

## User story
As a release manager, I want CI to build the OpenBucket Docker image on every PR and push to `main`, tag it deterministically from the SHA, cache layers via GHA, and upload the saved tarball as an artifact, so that the conformance job and downstream consumers can pull a known-good image without rebuilding.

## Description
Add the `build-image` job from §5.19: runs on `ubuntu-22.04` after `lint-and-test`, uses `docker/setup-buildx-action@v3`, computes a tag (`pr-<num>-<sha7>` for PRs, `main-<sha7>` for pushes), invokes `docker/build-push-action@v6` with `push: false, load: true`, `cache-from: type=gha`, `cache-to: type=gha,mode=max`, `docker save`s the result to `/tmp/openbucket.tar`, and uploads it as a 7-day-retention `docker-image` artifact. Exposes `image-tag` as a job output for the conformance job to consume.

## Acceptance criteria
- [ ] Job `build-image` exists with `needs: lint-and-test` and `permissions: { contents: read, packages: write }`.
- [ ] A `meta` step writes `tag=pr-<pr-num>-<sha7>` for `pull_request` events and `tag=main-<sha7>` otherwise to `$GITHUB_OUTPUT`.
- [ ] `docker/build-push-action@v6` runs with `context: .`, `file: Dockerfile`, `push: false`, `load: true`, `tags: openbucket:<tag>`, and GHA cache enabled in both directions.
- [ ] The image is `docker save`d to `/tmp/openbucket.tar` and uploaded as artifact `docker-image` with `retention-days: 7`.
- [ ] Job `outputs.image-tag` is set from the `meta` step.

## Tasks
- [TASK-1530] Add `build-image` job header, runner, needs, and permissions
- [TASK-1531] Implement the `meta` tag-computation step
- [TASK-1532] Wire `docker/build-push-action@v6` with GHA cache
- [TASK-1533] Save image to tar and upload as `docker-image` artifact

## Test plan
_The Story acceptance criteria are CI-green on a PR; the artifact's existence is consumed by [STORY-0504] which provides its own Test Plan._

## Dependencies
- Blocks: [STORY-0504]
- Blocked by: [STORY-0501], [STORY-0502]

## References
- `docs/WHITEPAPER.md` §5.19 (lines 8657–8698)
- Interfaces produced: GHA job `build-image`, artifact `docker-image`, output `image-tag`
- Interfaces consumed: `Dockerfile` from [STORY-0501]

## Verification (2026-07-07)
Verified against the live `ci.yml` `build-image` job, green on real GitHub Actions runs (PR #35 "build docker image" check + `main` pushes for #36–#38 all pass). Acceptance criteria met: `needs: lint-and-test`, `permissions: { contents: read, packages: write }`, `meta` step emits `pr-<n>-<sha7>` / `<tag>` / `main-<sha7>`, `build-push-action` runs `push: false` `load: true` `tags: openbucket:<tag>` with GHA cache both directions, `docker save` → `/tmp/openbucket.tar` uploaded as `docker-image` (retention 7d), and `outputs.image-tag` is wired. **Deviation:** `docker/build-push-action` is pinned to `@v7` (AC said `@v6`) — a version bump, behaviour-equivalent. Story closed.
