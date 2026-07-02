import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideArrowUpDown } from '@ng-icons/lucide';
import { HlmButton } from '@openbucket/spartan-ui/button';

export type SortDir = 'asc' | 'desc';

/**
 * Clickable, sortable table-header label. Renders inside an `hlmTh`. Shows a
 * neutral up/down glyph when inactive and a direction arrow when it's the active
 * sort column; emits `toggle` on click. Sort state itself lives in the host
 * component (a `sortKey`/`sortDir` signal pair).
 *
 * ```html
 * <th hlmTh>
 *   <ob-sort-header label="buckets.name" [active]="sortKey() === 'name'"
 *                   [dir]="sortDir()" (toggle)="toggleSort('name')" />
 * </th>
 * ```
 */
@Component({
  selector: 'ob-sort-header',
  standalone: true,
  imports: [TranslateModule, NgIcon, HlmButton],
  providers: [provideIcons({ lucideArrowUp, lucideArrowDown, lucideArrowUpDown })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      hlmBtn
      variant="ghost"
      size="sm"
      class="-ml-2 h-8 gap-1.5 data-[active=true]:text-foreground"
      [attr.data-active]="active()"
      [attr.aria-label]="(label() | translate) + ': ' + (active() ? dir() : 'not sorted')"
      (click)="sortToggle.emit()"
    >
      <span>{{ label() | translate }}</span>
      <ng-icon [name]="glyph()" class="text-muted-foreground text-sm" />
    </button>
  `,
})
export class SortHeaderComponent {
  readonly label = input.required<string>();
  readonly active = input(false);
  readonly dir = input<SortDir>('asc');
  readonly sortToggle = output<void>();

  protected readonly glyph = computed(() =>
    !this.active() ? 'lucideArrowUpDown' : this.dir() === 'asc' ? 'lucideArrowUp' : 'lucideArrowDown',
  );
}
