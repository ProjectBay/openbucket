---
id: STORY-0001
title: Scaffold backend Nx app and directory layout
epic: EPIC-01
status: done
size: S
risk: low
---

## User story
As a developer, I want the backend Nx project and source directory layout to exist with empty module skeletons, so that subsequent Stories can drop concrete files into known paths.

## Description
Lay out `apps/backend/src/` (aliasing `apps/openbucket-backend/src/`) with the directory structure specified in §1.1: `main.ts`, `app.module.ts`, `common/`, `s3/`, `admin/`, `domain/`, `storage/`, `persistence/`, `spa/`, `bootstrap/`. Create empty placeholder module files (`*.module.ts`) where §1.1 names a module so other Epics can import them without circular `// TODO` errors. No business logic yet — purely scaffolding.

## Acceptance criteria
- [ ] `apps/openbucket-backend/src/` contains the subdirectories named in §1.1 (`common/`, `s3/`, `admin/`, `domain/`, `storage/`, `persistence/`, `spa/`, `bootstrap/`).
- [ ] Each named module file in §1.1 exists as an empty `@Module({})` placeholder so the project compiles.
- [ ] `nx build openbucket-backend` succeeds against the scaffolded tree.
- [ ] `apps/backend/src` resolves to the backend source root (via alias / convention noted in §1.1).

## Tasks
- [TASK-0001] Create backend source directory tree per §1.1
- [TASK-0002] Add empty module placeholders for AppModule consumers

## Test plan
- [TEST-0001] Backend scaffold compiles and lints

## Dependencies
- Blocks: [STORY-0002], [STORY-0004]
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §1.1 (lines 53–122)
- Interfaces produced: directory layout aliases used by all subsequent §1 Stories
