---
id: TASK-1884
title: Contrast audit + token fixes across all 12 theme stylesheets
story: STORY-0616
status: done
type: implementation
size: M
---

## Description
Audit color contrast across all 12 theme stylesheets (light + dark blocks each) and fix the failing `--muted-foreground`, `--primary-foreground`, and `--ring` tokens so text meets WCAG 1.4.3 (4.5:1) and non-text/focus rings meet 3:1 (1.4.11). Add a repeatable token-contrast check so regressions are caught.

## Files to create / modify
- `apps/openbucket-frontend/src/styles/themes/blue.css` — modify (fix failing tokens in `:root` and `.dark`)
- `apps/openbucket-frontend/src/styles/themes/{gray,green,neutral,orange,red,rose,slate,stone,violet,yellow,zinc}.css` — modify (same)
- `apps/openbucket-frontend/tools/contrast-check.mjs` (or `scripts/`) — new (token-contrast check across the theme files)

## Implementation notes
- Each theme file defines OKLCH tokens in a `:root` (light) and `.dark` block: `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--ring`, plus `--sidebar*` variants. Example failing pair (blue, dark): `--muted-foreground: oklch(0.705 0.015 286.067)` against `--background: oklch(0.141 0.005 285.823)`.
- Audit each foreground/background pair that produces visible text or UI: `--foreground`/`--background`, `--muted-foreground`/`--background` (and `/--muted`), `--primary-foreground`/`--primary`, `--sidebar-foreground`/`--sidebar`. Compute the WCAG contrast ratio (convert OKLCH → sRGB → relative luminance → ratio). Targets: 4.5:1 for normal text (WCAG 1.4.3 AA), 3:1 for large text / UI components and focus indicators (1.4.11, 2.4.13/`--ring`).
- Fix by nudging the OKLCH lightness (`L`) of the foreground token (or `--ring`) until the ratio passes, keeping hue/chroma so the theme identity is preserved; document the before/after ratio per token inline in a comment or in the new check's output.
- The check script (`contrast-check.mjs`, runnable via `node` on Node 23) parses each `*.css`, computes ratios for the audited pairs, and exits non-zero if any pair is below its threshold — usable as a CLI gate.

## Acceptance criteria
- [ ] `nx build openbucket-frontend` and `nx lint openbucket-frontend` pass.
- [ ] `node apps/openbucket-frontend/tools/contrast-check.mjs` passes for all 12 themes (both light and dark blocks): text pairs ≥ 4.5:1, non-text/`--ring` ≥ 3:1.
- [ ] No theme's visual identity is broken (hue/chroma preserved; only lightness nudged where needed).

## Test obligations
- Unit: N/A.
- E2E: covered by [TEST-0616] (automated contrast check + manual low-vision spot check).
- Conformance: N/A.

## Dependencies
- Blocked by: [STORY-0600], [STORY-0603], [STORY-0604]

## References
- UX review 2026-06-22 (a11y A11Y-5 — contrast failures across themes; WCAG 1.4.3, 1.4.11).
- `apps/openbucket-frontend/src/styles/themes/*.css` (12 files, OKLCH `--muted-foreground`/`--primary-foreground`/`--ring`).
