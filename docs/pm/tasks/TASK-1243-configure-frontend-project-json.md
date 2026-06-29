---
id: TASK-1243
title: Configure project.json build options for SPA (baseHref, outputPath)
story: STORY-0414
status: done
type: infra
size: XS
---

## Description
Set `baseHref: '/admin/'` and `outputPath: 'dist/apps/frontend'` on the Angular build executor so the SPA is mounted under `/admin` and emitted where the backend static-serve module expects it.

## Files to create / modify
- `apps/frontend/project.json` — modify

## Implementation notes
- Build target excerpt verbatim from §5.11 (lines 7917–7923):
  ```jsonc
  "build": {
    "executor": "@angular-devkit/build-angular:application",
    "options": {
      "baseHref": "/admin/",
      "outputPath": "dist/apps/frontend"
    }
  }
  ```
- Backend static SPA mount belongs to BACKEND-DESIGN §8.3 — out of scope here.

## Acceptance criteria
- [ ] `nx build frontend` outputs assets under `dist/apps/frontend/` with a `<base href="/admin/">` in `index.html`.

## Test obligations
- Unit: covered by [TEST-0419]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1241]

## References
- `docs/WHITEPAPER.md` §5.11 (lines 7913–7924)
