import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  ViewEncapsulation,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HlmTabsImports } from '@openbucket/spartan-ui/tabs';
import { PageTabsVariantService } from './page-tabs-variant.service';
import { PageHeaderService } from '../../shell/services';

/** A single tab in {@link PageLayoutComponent}. `id` is the tab key (also the `?tab=` value). */
export interface PageTab {
  id: string;
  /** i18n key for the tab label. */
  label: string;
}

/**
 * Reusable tabbed page scaffold: a tab bar (style driven by the user's
 * `tabsVariant` preference) plus a padded content area. Tab BODIES are projected
 * (`<ng-content>`), so the host keeps ownership of routing/`?tab=` sync and lazy
 * content — this component only renders the bar and reports `hasTabs`.
 *
 * ```html
 * <ob-page-layout [tabs]="tabs" [activeTab]="activeTab()" (tabChange)="onTab($event)">
 *   @switch (activeTab()) { @case ('objects') { … } }
 * </ob-page-layout>
 * ```
 */
@Component({
  selector: 'ob-page-layout',
  standalone: true,
  imports: [TranslateModule, ...HlmTabsImports],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col">
      @if (tabs().length > 0) {
        <div class="bg-background px-6" [class.border-b]="tabsVariant.variant() === 'line'">
          <hlm-tabs [tab]="activeTab()" (tabActivated)="tabChange.emit($event)">
            <hlm-tabs-list
              [variant]="tabsVariant.variant()"
              class="justify-start overflow-x-auto"
              aria-label="Page navigation tabs"
            >
              @for (tab of tabs(); track tab.id) {
                <button [hlmTabsTrigger]="tab.id">{{ tab.label | translate }}</button>
              }
            </hlm-tabs-list>
          </hlm-tabs>
        </div>
      }

      <div class="flex-1 overflow-auto">
        <div class="p-6">
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class PageLayoutComponent implements OnDestroy {
  protected readonly tabsVariant = inject(PageTabsVariantService);
  private readonly pageHeader = inject(PageHeaderService);

  readonly tabs = input<PageTab[]>([]);
  /** The active tab id (owned by the host, typically synced to `?tab=`). */
  readonly activeTab = input<string>('');
  /** Emitted when a tab is clicked; the host updates its route/`?tab=`. */
  readonly tabChange = output<string>();

  constructor() {
    // Toggle the page-header bottom border to butt up against the tab strip.
    effect(() => this.pageHeader.setHasTabs(this.tabs().length > 0));
  }

  ngOnDestroy(): void {
    this.pageHeader.setHasTabs(false);
  }
}
