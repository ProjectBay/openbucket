import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePanelLeft } from '@ng-icons/lucide';
import { HlmSidebarService } from '@openbucket/spartan-ui/sidebar';

/**
 * Compact-variant top bar: just the mobile sidebar toggle. The page title and
 * primary action now render through the shared `ob-page-header` in the page body
 * (STORY-0601 / TASK-1806), so this header no longer carries a bespoke `<h1>` or
 * action button.
 */
@Component({
  selector: 'ob-compact-header',
  standalone: true,
  imports: [...HlmButtonImports, NgIcon],
  providers: [provideIcons({ lucidePanelLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="flex h-16 items-center border-b bg-background px-6">
      <button
        hlmBtn
        size="icon"
        variant="ghost"
        (click)="sidebarService.toggleSidebar()"
        class="md:hidden"
      >
        <ng-icon
          name="lucidePanelLeft"
          class="text-base"
        />
      </button>
    </header>
  `,
})
export class CompactHeader {
  protected readonly sidebarService = inject(HlmSidebarService);
}
