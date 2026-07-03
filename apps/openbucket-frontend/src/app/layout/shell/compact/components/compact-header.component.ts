import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePanelLeft } from '@ng-icons/lucide';
import { HlmSidebarService } from '@openbucket/spartan-ui/sidebar';
import { PageHeaderComponent } from '../../components';

/**
 * Compact-variant top bar: the mobile sidebar toggle PLUS the page header
 * (title / subtitle / primary action) rendered inline via `<ob-page-header dense>`.
 * Keeping the header in the sticky top bar (rather than a separate block below) is
 * what makes the compact variant compact.
 */
@Component({
  selector: 'ob-compact-header',
  standalone: true,
  imports: [...HlmButtonImports, NgIcon, PageHeaderComponent],
  providers: [provideIcons({ lucidePanelLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="flex h-16 items-center gap-2 border-b bg-background px-6">
      <button
        hlmBtn
        size="icon"
        variant="ghost"
        (click)="sidebarService.toggleSidebar()"
        class="shrink-0 md:hidden"
      >
        <ng-icon
          name="lucidePanelLeft"
          class="text-base"
        />
      </button>
      <ob-page-header
        [dense]="true"
        class="min-w-0 flex-1"
      />
    </header>
  `,
})
export class CompactHeader {
  protected readonly sidebarService = inject(HlmSidebarService);
}
