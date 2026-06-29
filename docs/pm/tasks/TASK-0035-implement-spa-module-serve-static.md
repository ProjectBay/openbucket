---
id: TASK-0035
title: Implement SpaModule with ServeStaticModule.forRoot
story: STORY-0013
status: done
type: implementation
size: S
---

## Description
Author `apps/backend/src/spa/spa.module.ts` per §1.9. Use `ServeStaticModule.forRoot` with `rootPath: join(__dirname, '..', 'spa')`, `serveRoot: '/admin'`, `exclude: ['/api/(.*)']`, and `serveStaticOptions: { index: 'index.html', fallthrough: true, setHeaders }`.

## Files to create / modify
- `apps/openbucket-backend/src/spa/spa.module.ts` — new

## Implementation notes
- Quote §1.9 (lines 878–909) verbatim:
  ```ts
  @Module({
    imports: [
      ServeStaticModule.forRoot({
        rootPath: join(__dirname, '..', 'spa'),
        serveRoot: '/admin',
        exclude: ['/api/(.*)'],
        serveStaticOptions: {
          index: 'index.html',
          fallthrough: true,
          setHeaders: (res, path) => { /* see TASK-0036 */ },
        },
      }),
    ],
  })
  export class SpaModule {}
  ```
- `rootPath` resolves to `apps/openbucket-backend/dist/spa/` at runtime — the Angular dist is copied here at Docker build (EPIC-06).

## Acceptance criteria
- [ ] `serveRoot === '/admin'`.
- [ ] `exclude` includes `'/api/(.*)'`.
- [ ] `serveStaticOptions.index === 'index.html'` and `fallthrough === true`.
- [ ] Module is imported last in `AppModule` (verified by TASK-0008).

## Test obligations
- Unit: N/A
- E2E: covered by [TEST-0014]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0001]

## References
- `docs/WHITEPAPER.md` §1.9 (lines 878–909)
