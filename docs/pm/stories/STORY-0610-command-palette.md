---
id: STORY-0610
title: ⌘K command palette & keyboard shortcuts
epic: EPIC-07
status: done
size: M
risk: low
---

## User story
As a power user, I want to press ⌘K to jump to any bucket, page, or action, and use single-key shortcuts to navigate, so I move through the console without hunting the sidebar.

## Description
The full spartan `command` library (dialog/search/group/item/shortcut) is installed and entirely unused; deep object paths make a palette especially valuable. Add it in the shell, seeded from the nav config + the bucket store, plus a small set of global shortcuts.

## Acceptance criteria
- [ ] A `CommandPaletteComponent` (`HlmCommandDialog` + search/list/group/item/shortcut) opens on ⌘K/Ctrl-K via a shell `@HostListener`.
- [ ] Groups: static nav (from `sidebarConfig`), a dynamic Buckets group (from `BucketsSignalStore`), and Actions (Create bucket, Create key, toggle theme).
- [ ] Global shortcuts: `/` focus object search, `g b`/`g k` go to buckets/keys, `Esc` close; hints rendered with `hlm-kbd`.
- [ ] The header brand ⌘ icon is a clickable palette trigger (discoverability).

## Tasks
- [TASK-1849] Build `layout/shell/command-palette.component.ts` on `HlmCommandImports`; open on ⌘K.
- [TASK-1850] Seed groups from `sidebarConfig` + `BucketsSignalStore`; add Action items (incl. theme toggle via `AppearanceStore`).
- [TASK-1851] Add global keyboard shortcuts + `hlm-kbd` hints.
- [TASK-1852] Make the header brand icon trigger the palette; add palette i18n keys.

## Test plan
- [TEST-0610] Manual: ⌘K opens; typing filters across groups; selecting navigates/acts; shortcuts work; Esc closes; screen-reader announces the dialog.

## Dependencies
- Blocks: _none_
- Blocked by: [STORY-0602]

## References
- UX review 2026-06-22 (IA E/F6; power-user F/F7).
- `libs/ui/spartan/{command,kbd}`, `apps/openbucket-frontend/src/app/layout/shell/**`, `layout/sidebar/data/sidebar.data.ts`, `buckets/buckets.signal-store.ts`, `core/platform/common/appearance/store/appearance.store.ts`.
