import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import { PageHeaderService } from '../services';

/**
 * Single source of truth for the page title, subtitle and primary action
 * (STORY-0601 / TASK-1806). Rendered in the body of every routed page, so all
 * three shell variants (inset/sticky/compact) show the same title size and the
 * same `PageHeaderService` action button — no per-variant divergence.
 */
@Component({
  selector: 'ob-page-header',
  standalone: true,
  imports: [TranslateModule, NgIcon, ...HlmButtonImports],
  providers: [provideIcons({ lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pageHeader.pageTitle() || pageHeader.pageSubtitle() || pageHeader.showAction()) {
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
            <p class="text-sm text-muted-foreground mt-1">
              {{ pageHeader.pageSubtitle() | translate }}
            </p>
          }
        </div>

        @if (pageHeader.showAction()) {
          <button
            hlmBtn
            size="sm"
            class="shrink-0 gap-2"
            (click)="pageHeader.executeAction()"
          >
            <ng-icon
              name="lucidePlus"
              class="text-base"
            />
            <span>{{ pageHeader.actionLabel() | translate }}</span>
          </button>
        }
      </div>
    }
  `,
})
export class PageHeaderComponent {
  protected readonly pageHeader = inject(PageHeaderService);
}
