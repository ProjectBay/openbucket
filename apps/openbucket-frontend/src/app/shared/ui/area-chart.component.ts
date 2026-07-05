import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** One point on an area chart: an x timestamp label + a numeric y value. */
export interface AreaPoint {
  /** ISO timestamp (used only for the aria summary; the x-axis is index-based). */
  t: string;
  value: number;
}

/** viewBox geometry — a fixed logical canvas the SVG scales to its container. */
const VIEW_W = 600;
const VIEW_H = 160;
const PAD = 4;

/**
 * Hand-rolled inline-SVG area chart (§STORY-1102) — no charting dependency. Plots
 * `{ t, value }[]` as a filled path over a baseline, scaled with a linear map into
 * a fixed `viewBox` and rendered at `width: 100%` so the page never scrolls
 * horizontally. Uses `currentColor` + Tailwind theme tokens so it matches
 * StatCardComponent in light and dark. `role="img"` + an `aria-label` summary
 * keeps it accessible.
 */
@Component({
  selector: 'ob-area-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (points().length > 0) {
      <svg
        [attr.viewBox]="viewBox"
        preserveAspectRatio="none"
        class="text-primary h-40 w-full"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        <path [attr.d]="areaPath()" class="fill-current opacity-10" />
        <path
          [attr.d]="linePath()"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
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
export class AreaChartComponent {
  readonly points = input<AreaPoint[]>([]);
  /** Text shown (and announced) when there are no points yet. */
  readonly emptyLabel = input<string>('Collecting data…');
  /** Short human description of the series for the aria-label. */
  readonly seriesLabel = input<string>('series');

  protected readonly viewBox = `0 0 ${VIEW_W} ${VIEW_H}`;

  private readonly scaled = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return [] as { x: number; y: number }[];
    const max = Math.max(...pts.map((p) => p.value), 1);
    const n = pts.length;
    return pts.map((p, i) => ({
      x: n === 1 ? VIEW_W / 2 : PAD + (i / (n - 1)) * (VIEW_W - 2 * PAD),
      y: VIEW_H - PAD - (p.value / max) * (VIEW_H - 2 * PAD),
    }));
  });

  protected readonly linePath = computed(() => {
    const s = this.scaled();
    if (s.length === 0) return '';
    return s.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  });

  protected readonly areaPath = computed(() => {
    const s = this.scaled();
    if (s.length === 0) return '';
    const baseline = VIEW_H - PAD;
    const line = s
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');
    return `${line} L${s[s.length - 1].x.toFixed(2)} ${baseline} L${s[0].x.toFixed(2)} ${baseline} Z`;
  });

  protected readonly ariaLabel = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return `${this.seriesLabel()}: no data yet`;
    const last = pts[pts.length - 1].value;
    return `${this.seriesLabel()}: ${pts.length} points, latest ${last}`;
  });
}
