---
id: TASK-1803
title: Add an app-wide screen-reader status announcer
story: STORY-0600
status: done
type: implementation
size: S
---

## Description
Add a `StatusAnnouncer` so async status (loading, success, failure, route changes, upload progress) is announced to screen readers. Build it once here; STORY-0604/0606/0616 consume it. Also verify the sonner toaster already exposes an `aria-live` region.

## Files to create / modify
- `apps/openbucket-frontend/src/app/shared/ui/status-announcer.service.ts` — new
- `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts` — modify (provide/inject, no visual change) — optional if the service is `providedIn: 'root'`

## Implementation notes
- Wrap CDK `LiveAnnouncer` from `@angular/cdk/a11y` (CDK is already a transitive dep via `@spartan-ng/brain`). Service is `@Injectable({ providedIn: 'root' })` with `announce(message: string, politeness: 'polite' | 'assertive' = 'polite')` delegating to `LiveAnnouncer.announce(message, politeness)`.
- Prefer the CDK `LiveAnnouncer` over a hand-rolled `role="status"` div (it manages the visually-hidden live region + politeness for you).
- Verify `ngx-sonner-toaster` renders an `aria-live` region (`HlmToaster` wraps `<ngx-sonner-toaster>`); if it does not announce, call `announce()` alongside `notify` for critical messages. Record the finding inline.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `StatusAnnouncer.announce('x')` is read by a screen reader (manual: NVDA/VoiceOver); polite vs assertive honored.
- [ ] The sonner toaster's `aria-live` behavior is confirmed (and supplemented if absent).

## Test obligations
- Unit: covered by [TEST-0600] (delegates to `LiveAnnouncer.announce`).
- E2E: N/A.
- Conformance: N/A — manual a11y verification.

## Dependencies
- Blocked by: _none_

## References
- UX review 2026-06-22 (a11y A11Y-3 — no `aria-live` anywhere; WCAG 4.1.3 Status Messages).
- `@angular/cdk/a11y` (`LiveAnnouncer`), `libs/ui/spartan/sonner`, `apps/openbucket-frontend/src/app/layout/shell/dynamic-shell.component.ts`.
- Interfaces produced: `StatusAnnouncer` (consumed by STORY-0604/0606/0616).
