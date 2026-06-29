---
id: TASK-1878
title: Add "Copy share link" + expiry select to the object row menu
story: STORY-0615
status: done
type: implementation
size: S
---

## Description
Add a "Copy share link" entry to the per-object row `HlmDropdownMenu` (built in STORY-0604) with an expiry chooser offering 1h / 24h / 7d, capped at the backend `MAX_EXPIRES`. This task lands the menu entry + expiry `hlm-select` and emits the chosen expiry; the presign call/copy is TASK-1879.

## Files to create / modify
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts` — modify (add the menu item + expiry select to the row dropdown; emit/handle the chosen object + expiry)
- `apps/openbucket-frontend/src/app/objects/share-link.component.ts` — new (small standalone, OnPush control: expiry `hlm-select` + trigger, reused inside the row menu)

## Implementation notes
- STORY-0604 (TASK-1823) adds `HlmDropdownMenu` (`@openbucket/spartan-ui/menu`) row actions (Copy key, Copy URL, Download, Delete, View details). Add a "Copy share link" item alongside them with a `lucideLink`/`lucideShare2` icon (`@ng-icons/lucide`).
- Expiry options as constants, e.g. `const SHARE_EXPIRIES = [{ label: '1 hour', seconds: 3600 }, { label: '24 hours', seconds: 86400 }, { label: '7 days', seconds: 604800 }]`, rendered via `hlm-select` (`@openbucket/spartan-ui/select`). Default to 24h.
- The 7d option (604800s) must be capped at the backend `MAX_EXPIRES` (the presign endpoint from STORY-0612 / TASK-1863 enforces `MAX_EXPIRES`; SigV4 query-presign max is 7 days = 604800s). Do not offer an option exceeding `MAX_EXPIRES`; if the backend cap is lower, the over-cap option is disabled/omitted.
- The control emits `{ key, expiresIn }`; TASK-1879 wires the actual presign request.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] The object row menu shows "Copy share link" with a 1h/24h/7d expiry `hlm-select`; no option exceeds `MAX_EXPIRES`.
- [ ] Selecting an expiry and triggering emits the chosen object key + `expiresIn` (seconds).
- [ ] The menu items remain keyboard-operable (menu focus management from the spartan primitive).

## Test obligations
- Unit: covered by [TEST-0615] (expiry options capped; emits key + expiresIn).
- E2E: covered by [TEST-0615] (manual: menu shows options).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0604], [STORY-0612]

## References
- UX review 2026-06-22 (power-user G; feature-gap table — no share-link generator).
- `apps/openbucket-frontend/src/app/objects/object-browser.component.ts`, `libs/ui/spartan/{menu,select}`, `apps/openbucket-backend/src/s3/sigv4/presigned.ts` (`MAX_EXPIRES`).
- Interfaces consumed: row `HlmDropdownMenu` from STORY-0604 (TASK-1823).
