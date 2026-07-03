import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import { PageHeaderService } from '../services';

/**
 * Single source of truth for the page title, subtitle and primary action
 * (STORY-0601 / TASK-1806). Rendered by every shell variant so they all show the
 * same title + `PageHeaderService` action.
 *
 * Two layouts:
 * - **block** (default) — a full-width `px-6 py-4` header, used by the inset/sticky
 *   variants below their top bar.
 * - **dense** (`[dense]="true"`) — an inline title/subtitle/action row with no
 *   padding/border, meant to sit INSIDE the compact variant's sticky top bar.
 */
@Component({
  selector: 'ob-page-header',
  standalone: true,
  imports: [TranslateModule, NgIcon, ...HlmButtonImports],
  providers: [provideIcons({ lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pageHeader.pageTitle() || pageHeader.pageSubtitle() || pageHeader.showAction()) {
      @if (dense()) {
        <div class="flex min-w-0 flex-1 items-center justify-between gap-4">
          <div class="min-w-0">
            @if (pageHeader.pageTitle()) {
              <h1 class="truncate text-lg font-semibold leading-tight tracking-tight">
                {{ pageHeader.pageTitle() | translate }}
              </h1>
            }
            @if (pageHeader.pageSubtitle()) {
              <p class="text-muted-foreground truncate text-xs">
                {{ pageHeader.pageSubtitle() | translate }}
              </p>
            }
          </div>
          @if (pageHeader.showAction()) {
            <button hlmBtn size="sm" class="shrink-0 gap-2" (click)="pageHeader.executeAction()">
              <ng-icon name="lucidePlus" class="text-base" />
              <span>{{ pageHeader.actionLabel() | translate }}</span>
            </button>
          }
        </div>
      } @else {
        <div
          class="bg-background flex items-start justify-between gap-4 px-6 py-4"
          [class.border-b]="!pageHeader.hasTabs()"
        >
          <div>
            @if (pageHeader.pageTitle()) {
              <h1 class="text-2xl font-semibold tracking-tight">
                {{ pageHeader.pageTitle() | translate }}
              </h1>
            }
            @if (pageHeader.pageSubtitle()) {
              <p class="text-muted-foreground mt-1 text-sm">
                {{ pageHeader.pageSubtitle() | translate }}
              </p>
            }
          </div>

          @if (pageHeader.showAction()) {
            <button hlmBtn size="sm" class="shrink-0 gap-2" (click)="pageHeader.executeAction()">
              <ng-icon name="lucidePlus" class="text-base" />
              <span>{{ pageHeader.actionLabel() | translate }}</span>
            </button>
          }
        </div>
      }
    }
  `,
})
export class PageHeaderComponent {
  protected readonly pageHeader = inject(PageHeaderService);
  /** Inline layout for embedding inside the compact top bar. */
  readonly dense = input(false);
}
