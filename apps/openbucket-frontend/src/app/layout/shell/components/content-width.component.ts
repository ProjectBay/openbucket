import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppearanceStore } from '../../../core/platform/common/appearance';

/**
 * Constrains the page content to the user's preferred reading width
 * (`AppearanceStore.contentMaxWidth`), centered. `full` applies no cap. Wraps the
 * router outlet in every shell variant so page width is a single, consistent,
 * user-controlled setting instead of each page hardcoding its own `max-w-*`.
 */
@Component({
  selector: 'ob-content-width',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mx-auto w-full"
      [class.max-w-2xl]="width() === '2xl'"
      [class.max-w-3xl]="width() === '3xl'"
      [class.max-w-4xl]="width() === '4xl'"
      [class.max-w-5xl]="width() === '5xl'"
    >
      <ng-content />
    </div>
  `,
})
export class ContentWidthComponent {
  private readonly appearance = inject(AppearanceStore);
  protected readonly width = computed(() => this.appearance.contentMaxWidth());
}
