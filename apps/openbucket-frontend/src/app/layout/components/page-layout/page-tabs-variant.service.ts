import { Injectable, inject, computed } from '@angular/core';
import { AppearanceStore, type TabsVariant } from '../../../core/platform/common/appearance';

/**
 * Derives the page tab style (`default` | `line`, matching Spartan's
 * `hlm-tabs-list` variants) from the persisted {@link AppearanceStore}, so the
 * user preference applies everywhere `PageLayoutComponent` renders tabs.
 */
@Injectable({ providedIn: 'root' })
export class PageTabsVariantService {
  private readonly appearance = inject(AppearanceStore);

  readonly variant = computed(() => this.appearance.tabsVariant());

  setVariant(variant: TabsVariant): void {
    this.appearance.setTabsVariant(variant);
  }

  toggle(): void {
    this.setVariant(this.variant() === 'default' ? 'line' : 'default');
  }
}
