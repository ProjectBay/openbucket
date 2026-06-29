---
id: TASK-1800
title: Add a `notify` toast helper over ngx-sonner
story: STORY-0600
status: done
type: implementation
size: XS
---

## Description
Add a thin `notify` helper wrapping the `ngx-sonner` `toast` API so feature code has one consistent way to fire success/error/promise toasts. The `HlmToaster` is already mounted (`app.component.html`); this only adds the call surface.

## Files to create / modify
- `apps/openbucket-frontend/src/app/shared/ui/notify.ts` — new
- `apps/openbucket-frontend/src/app/app.component.ts` — modify only if toaster position/options need tuning (else leave as-is)

## Implementation notes
- `ngx-sonner` exports `export declare const toast: typeof toastFunction & {...}` — use `import { toast } from 'ngx-sonner';`. Expose:
  - `notify.success(message: string, opts?)` → `toast.success(...)`
  - `notify.error(message: string, opts?)` → `toast.error(...)`
  - `notify.promise(p, { loading, success, error })` → `toast.promise(p, ...)`
- Keep `HlmToaster` (`selector: 'hlm-toaster'`, `<hlm-toaster />` in `app.component.html`) as the single mounted toaster; do not mount a second one.
- Pure functions (no Angular DI) so any component/store can import it; keep it framework-thin so it can be swapped if the toaster lib changes.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] Importing `notify` and calling `notify.success('x')` shows a toast in the running app; `notify.promise(...)` transitions loading→success/error.
- [ ] Exactly one `<hlm-toaster />` remains in the app.

## Test obligations
- Unit: covered by [TEST-0600] (notify delegates to the ngx-sonner `toast`; run if the frontend jest harness is wired).
- E2E: N/A.
- Conformance: N/A.

## Dependencies
- Blocked by: _none_

## References
- UX review 2026-06-22 (interaction lens F1 — toaster mounted but `toast()` never called).
- `node_modules/ngx-sonner` (`toast`), `libs/ui/spartan/sonner` (`HlmToaster`), `apps/openbucket-frontend/src/app/app.component.{ts,html}`.
- Interfaces produced: `notify` (consumed by STORY-0603/0604/0606/0611, etc.).
