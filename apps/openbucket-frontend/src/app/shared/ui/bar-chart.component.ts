import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ByteSizePipe } from './byte-size.pipe';

/** One horizontal bar: a label and a numeric value (bytes). */
export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Hand-rolled horizontal bar breakdown (§STORY-1102) — no charting dependency.
 * Each row is a label, a proportional bar (width = value / max), and the value
 * formatted by {@link ByteSizePipe}. Uses Tailwind theme tokens so it matches
 * StatCardComponent in light and dark; `width: 100%` bars never overflow. A
 * zero-value datum renders a zero-width bar (kept, not omitted). `role="img"` +
 * an `aria-label` summary keeps it accessible.
 */
@Component({
  selector: 'ob-bar-chart',
  standalone: true,
  imports: [ByteSizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data().length > 0) {
      <div class="flex flex-col gap-3" role="img" [attr.aria-label]="ariaLabel()">
        @for (row of rows(); track row.label) {
          <div class="space-y-1">
            <div class="flex items-center justify-between text-sm">
              <span class="truncate font-medium" [title]="row.label">{{ row.label }}</span>
              <span class="text-muted-foreground tabular-nums">{{ row.value | byteSize }}</span>
            </div>
            <div class="bg-muted h-2 w-full overflow-hidden rounded-full">
              <div
                class="bg-primary h-full rounded-full"
                [style.width.%]="row.pct"
              ></div>
            </div>
          </div>
        }
      </div>
    } @else {
      <div
        class="text-muted-foreground flex h-40 items-center justify-center text-sm"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        {{ emptyLabel() }}
      </div>
    }
  `,
})
export class BarChartComponent {
  readonly data = input<BarDatum[]>([]);
  /** Text shown (and announced) when there is no data yet. */
  readonly emptyLabel = input<string>('Collecting data…');
  /** Short human description of the series for the aria-label. */
  readonly seriesLabel = input<string>('breakdown');

  protected readonly rows = computed(() => {
    const data = this.data();
    const max = Math.max(...data.map((d) => d.value), 1);
    return data.map((d) => ({ label: d.label, value: d.value, pct: (d.value / max) * 100 }));
  });

  protected readonly ariaLabel = computed(() => {
    const data = this.data();
    if (data.length === 0) return `${this.seriesLabel()}: no data yet`;
    return `${this.seriesLabel()}: ${data.length} bars`;
  });
}
