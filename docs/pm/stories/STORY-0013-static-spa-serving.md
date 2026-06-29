---
id: STORY-0013
title: Serve Angular admin SPA under /admin with cache headers and fallback
epic: EPIC-01
status: done
size: S
risk: low
---

## User story
As an admin user, I want the Angular admin SPA to be served at `/admin` with `index.html` fallback for deep links and correct cache headers (immutable hashed assets, no-cache index), so that page refreshes and redeploys behave correctly.

## Description
Implement `apps/backend/src/spa/spa.module.ts` per §1.9. Use `ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'spa'), serveRoot: '/admin', exclude: ['/api/(.*)'], serveStaticOptions: { index: 'index.html', fallthrough: true, setHeaders } })`. The `setHeaders` callback emits `Cache-Control: no-cache, no-store, must-revalidate` (+ `Pragma: no-cache`, `Expires: 0`) for `index.html`; `Cache-Control: public, max-age=31536000, immutable` for hashed assets matching `/\.[0-9a-f]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/i`; otherwise `Cache-Control: public, max-age=300`.

## Acceptance criteria
- [ ] `GET /admin/` returns the SPA `index.html` with the no-cache trio of headers. — code-complete; **runtime verification deferred to EPIC-06** (needs a built `dist/spa`).
- [ ] `GET /admin/main.<hash>.js` returns the hashed bundle with `Cache-Control: public, max-age=31536000, immutable`. — code-complete; **deferred to EPIC-06**.
- [ ] `GET /admin/<unknown-deeplink>` falls back to `index.html` with status 200. — code-complete; **deferred to EPIC-06**.
- [x] `GET /api/admin/health` is not shadowed by the SPA (the `exclude: ['/api/(.*)']` rule wins).
- [x] `SpaModule` is imported **last** in `AppModule`.

## Tasks
- [TASK-0035] Implement SpaModule with ServeStaticModule.forRoot
- [TASK-0036] Implement setHeaders cache-control branches

## Test plan
- [TEST-0014] SPA serving, fallback, and cache headers (e2e)

## Milestone note
Closed at the M0→M1 boundary. The `SpaModule` + `setHeaders` cache-control
branches are code-complete per §1.9. What is **verified** in M0 is the
no-build guard: with no `dist/spa` present, `SpaModule.forRoot()` registers
nothing, `/admin/` does not 5xx, and boot/liveness are unaffected
(`openbucket-backend-e2e/src/spa.e2e-spec.ts`). The cache-header / immutable-asset
/ deep-link-fallback cases (TEST-0014 1–4) require a populated `dist/spa` and are
verified by the **EPIC-06** conformance image build, not here.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0001], [STORY-0007]

## References
- `docs/WHITEPAPER.md` §1.9 (lines 873–919)
- Interfaces produced: `SpaModule` (consumed by STORY-0004)
