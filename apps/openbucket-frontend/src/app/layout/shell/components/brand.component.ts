import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { CommandPaletteService } from '../command-palette.service';

/**
 * Product brand mark + wordmark (STORY-0601 / TASK-1805). Single source for the
 * "OpenBucket" identity. The mark is inline SVG using `currentColor` so it
 * inherits `text-sidebar-primary-foreground` (and every theme/dark mode). When
 * `commandTrigger` is set (in the shell sidebars), clicking it opens the ⌘K
 * command palette (STORY-0610 / TASK-1852).
 */
@Component({
  selector: 'ob-brand',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex items-center gap-2 w-full',
    '[class.cursor-pointer]': 'commandTrigger()',
    '[attr.role]': "commandTrigger() ? 'button' : null",
    '[attr.tabindex]': 'commandTrigger() ? 0 : null',
    '[attr.aria-label]': "commandTrigger() ? 'Open command palette (Ctrl/Cmd K)' : null",
    '(click)': 'onActivate()',
    '(keydown.enter)': 'onActivate()',
    '(keydown.space)': 'onActivate($event)',
  },
  template: `
    <span
      class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-5"
        aria-hidden="true"
      >
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6l1.3 12.1A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 2-1.9L20 6" />
        <path d="M4 6c0 1.66 3.58 3 8 3s8-1.34 8-3" />
      </svg>
    </span>
    @if (!iconOnly()) {
      <span class="grid flex-1 text-left text-sm leading-tight">
        <span class="truncate font-medium">OpenBucket</span>
        @if (subtitle()) {
          <span class="truncate text-xs">{{ subtitle() }}</span>
        }
      </span>
    }
  `,
})
export class BrandComponent {
  private readonly palette = inject(CommandPaletteService);

  readonly subtitle = input('Workspace');
  readonly iconOnly = input(false);
  readonly commandTrigger = input(false);

  onActivate(e?: Event): void {
    if (!this.commandTrigger()) return;
    e?.preventDefault();
    this.palette.open();
  }
}
