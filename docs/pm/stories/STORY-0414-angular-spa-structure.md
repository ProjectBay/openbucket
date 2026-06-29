---
id: STORY-0414
title: Bootstrap Angular SPA structure
epic: EPIC-05
status: done
size: S
risk: low
---

## User story
As an admin user, I want an Angular 18+ standalone SPA scaffolded under `apps/frontend/`, so that subsequent Stories can drop in routes, components, and services.

## Description
Lay out the SPA directory tree from §5.10 with empty placeholder files: `app.config.ts`, `app.routes.ts`, `app.component.ts`, `main.ts`, and the `auth/`, `buckets/`, `objects/`, `keys/`, `settings/`, `shared/layout/`, `shared/ui/`, `shared/api/` subdirectories. Implement `main.ts` and `app.config.ts` per §5.10: `bootstrapApplication(AppComponent, appConfig)`, providers `provideZoneChangeDetection({ eventCoalescing: true })`, `provideRouter(routes, withComponentInputBinding())`, `provideHttpClient(withFetch(), withInterceptors([authInterceptor]))`, `provideApiClient()`. Configure build `baseHref: '/admin/'` and `outputPath: 'dist/apps/frontend'` in `apps/frontend/project.json`.

## Acceptance criteria
- [x] Directory tree under `apps/frontend/src/app/` matches §5.10.
- [x] `main.ts` calls `bootstrapApplication(AppComponent, appConfig).catch(...)`.
- [x] `app.config.ts` exports `appConfig: ApplicationConfig` with the four providers listed above.
- [x] `apps/frontend/project.json` build target sets `"baseHref": "/admin/"` and `"outputPath": "dist/apps/frontend"`.
- [x] `nx build frontend` succeeds against the scaffold.
- [x] Every component is `standalone: true`.

## Tasks
- [TASK-1241] Scaffold frontend directory tree with placeholder files
- [TASK-1242] Implement `main.ts` and `app.config.ts`
- [TASK-1243] Configure `project.json` build options for SPA

## Test plan
- [TEST-0419] Frontend scaffold builds

## Dependencies
- Blocks: [STORY-0415], [STORY-0416], [STORY-0417], [STORY-0418], [STORY-0419]
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §5.10 (lines 7747–7825)
- `docs/BACKEND-DESIGN.md` §6 (static SPA mount)
- Interfaces produced: `AppComponent`, `appConfig`, frontend directory layout
