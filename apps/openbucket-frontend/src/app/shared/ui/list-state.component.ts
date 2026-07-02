import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HlmSkeleton } from '@openbucket/spartan-ui/skeleton';
import { HlmEmptyImports } from '@openbucket/spartan-ui/empty';

/**
 * Shared loading / error / empty scaffold for list pages, so each list stops
 * re-implementing the same skeleton → error → empty → content ladder.
 *
 * Usage:
 * ```html
 * <ob-list-state [loading]="store.loading()" [error]="store.error()"
 *                [empty]="store.count() === 0" emptyTitle="buckets.empty"
 *                emptyHint="buckets.emptyHint">
 *   <button listEmptyAction hlmBtn (click)="create()">Create</button>
 *   <table hlmTable>…</table>   <!-- default slot: the loaded content -->
 * </ob-list-state>
 * ```
 */
@Component({
  selector: 'ob-list-state',
  standalone: true,
  imports: [TranslateModule, HlmSkeleton, HlmEmptyImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="space-y-2">
        @for (r of skeletonRows(); track r) {
          <div hlmSkeleton class="h-12 w-full rounded-md"></div>
        }
      </div>
    } @else if (error()) {
      <p class="text-destructive text-sm font-medium">{{ error() }}</p>
    } @else if (empty()) {
      <div hlm-empty>
        <div hlm-empty-header>
          <h3 hlmEmptyTitle>{{ emptyTitle() | translate }}</h3>
          @if (emptyHint()) {
            <p hlmEmptyDescription>{{ emptyHint()! | translate }}</p>
          }
        </div>
        <ng-content select="[listEmptyAction]" />
      </div>
    } @else {
      <ng-content />
    }
  `,
})
export class ListStateComponent {
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly empty = input(false);
  /** i18n key for the empty-state title. */
  readonly emptyTitle = input('');
  /** i18n key for the empty-state hint (optional). */
  readonly emptyHint = input<string | null>(null);
  readonly skeletonCount = input(5);

  protected readonly skeletonRows = computed(() =>
    Array.from({ length: this.skeletonCount() }, (_, i) => i),
  );
}
