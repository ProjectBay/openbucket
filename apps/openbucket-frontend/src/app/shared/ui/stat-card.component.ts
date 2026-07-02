import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon } from '@ng-icons/core';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmSkeleton } from '@openbucket/spartan-ui/skeleton';

/**
 * Compact KPI / stat tile — a label, a large value, and a trailing icon, with a
 * loading skeleton. Replaces the repeated inline `hlmCard` KPI blocks.
 *
 * The icon is resolved from the HOST component's `provideIcons(...)` registry
 * (pass the lucide icon name), so this component stays icon-agnostic.
 */
@Component({
  selector: 'ob-stat-card',
  standalone: true,
  imports: [TranslateModule, NgIcon, HlmCardImports, HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmCard>
      <div hlmCardHeader class="flex-row items-center justify-between gap-2 pb-2">
        <span hlmCardDescription>{{ label() | translate }}</span>
        @if (icon()) {
          <ng-icon [name]="icon()!" class="text-muted-foreground text-base" />
        }
      </div>
      <div hlmCardContent>
        @if (loading()) {
          <div hlmSkeleton class="h-8 w-24"></div>
        } @else {
          <p class="text-2xl font-semibold tabular-nums">{{ value() }}</p>
        }
      </div>
    </div>
  `,
})
export class StatCardComponent {
  /** i18n key for the metric label. */
  readonly label = input.required<string>();
  /** The metric value (pre-formatted; e.g. a count or a byte-size string). */
  readonly value = input.required<string | number>();
  /** Lucide icon name (must be registered by the host via `provideIcons`). */
  readonly icon = input<string | null>(null);
  /** Show a skeleton instead of the value while data loads. */
  readonly loading = input<boolean>(false);
}
