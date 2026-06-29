---
id: TASK-1242
title: Implement main.ts and app.config.ts
story: STORY-0414
status: done
type: implementation
size: S
---

## Description
Wire the standalone Angular bootstrap (`main.ts`) and provider list (`app.config.ts`) per §5.10.

## Files to create / modify
- `apps/frontend/src/main.ts` — new
- `apps/frontend/src/app/app.config.ts` — new

## Implementation notes
- `main.ts` verbatim from §5.10 (lines 7796–7801):
  ```ts
  import { bootstrapApplication } from '@angular/platform-browser';
  import { AppComponent } from './app/app.component';
  import { appConfig } from './app/app.config';
  bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
  ```
- `app.config.ts` verbatim from §5.10 (lines 7805–7821):
  ```ts
  export const appConfig: ApplicationConfig = {
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
      provideApiClient(),
    ],
  };
  ```

## Acceptance criteria
- [ ] `main.ts` calls `bootstrapApplication(AppComponent, appConfig)`.
- [ ] `appConfig.providers` includes the four providers listed above.
- [ ] `nx build frontend` succeeds.

## Test obligations
- Unit: covered by [TEST-0419]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1241]

## References
- `docs/WHITEPAPER.md` §5.10 (lines 7794–7822)
