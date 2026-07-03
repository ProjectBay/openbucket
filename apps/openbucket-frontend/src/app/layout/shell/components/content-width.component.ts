import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppearanceStore } from '../../../core/platform/common/appearance';
import { PageHeaderService } from '../services';

/**
 * Constrains page content to the user's preferred reading width
 * (`AppearanceStore.contentMaxWidth`) and alignment (`contentAlignment`). `full`
 * applies no cap. Wraps the router outlet in every shell variant, so page width is
 * one consistent, user-controlled setting.
 *
 * On TABBED pages (`PageHeaderService.hasTabs()`), this stays full width so the
 * tab bar spans the whole page — `PageLayoutComponent` applies the width/alignment
 * to the tab CONTENT itself.
 */
@Component({
  selector: 'ob-content-width',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full"
      [class.mx-auto]="!hasTabs() && alignment() === 'center'"
      [class.max-w-2xl]="!hasTabs() && width() === '2xl'"
      [class.max-w-3xl]="!hasTabs() && width() === '3xl'"
      [class.max-w-4xl]="!hasTabs() && width() === '4xl'"
      [class.max-w-5xl]="!hasTabs() && width() === '5xl'"
    >
      <ng-content />
    </div>
  `,
})
export class ContentWidthComponent {
  private readonly appearance = inject(AppearanceStore);
  private readonly pageHeader = inject(PageHeaderService);
  protected readonly width = computed(() => this.appearance.contentMaxWidth());
  protected readonly alignment = computed(() => this.appearance.contentAlignment());
  protected readonly hasTabs = this.pageHeader.hasTabs;
}
