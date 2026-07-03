import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleArrowUp,
  lucideCircleCheck,
  lucideExternalLink,
  lucideRefreshCw,
} from '@ng-icons/lucide';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmBadge } from '@openbucket/spartan-ui/badge';

import { GH_RELEASES, NPM_PAGE, UpdatesService } from '../shared/updates/updates.service';
import { MarkdownPipe } from '../shared/ui/markdown.pipe';
import { PageHeaderService } from '../layout/shell/services';

/**
 * About / updates page (route `/about`): the running OpenBucket version, an update
 * check against GitHub Releases, links to Releases + npm, and the full changelog
 * (markdown-rendered). State comes from the shared {@link UpdatesService}.
 */
@Component({
  selector: 'ob-about',
  standalone: true,
  imports: [TranslateModule, NgIcon, HlmCardImports, HlmButton, HlmBadge, MarkdownPipe],
  providers: [
    provideIcons({ lucideCircleArrowUp, lucideCircleCheck, lucideExternalLink, lucideRefreshCw }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 p-6">
      <div hlmCard>
        <div hlmCardContent class="space-y-4 pt-6">
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ 'about.currentVersion' | translate }}</span>
              <span hlmBadge variant="secondary" class="font-mono">
                {{ updates.current() ? 'v' + updates.current() : '—' }}
              </span>
            </div>

            @if (updates.updateAvailable()) {
              <a hlmBadge [href]="updates.latestUrl()" target="_blank" rel="noopener" class="gap-1">
                <ng-icon name="lucideCircleArrowUp" class="text-sm" />
                {{ 'about.updateAvailable' | translate }} v{{ updates.latest() }}
              </a>
            } @else if (updates.latest() && !updates.checkFailed()) {
              <span hlmBadge variant="outline" class="text-muted-foreground gap-1">
                <ng-icon name="lucideCircleCheck" class="text-sm" />
                {{ 'about.upToDate' | translate }}
              </span>
            } @else if (updates.checkFailed()) {
              <span class="text-muted-foreground text-xs">{{ 'about.checkFailed' | translate }}</span>
            }

            <button
              hlmBtn
              variant="ghost"
              size="sm"
              class="ml-auto"
              [disabled]="updates.loading()"
              (click)="updates.check()"
            >
              <ng-icon name="lucideRefreshCw" class="text-base" [class.animate-spin]="updates.loading()" />
              {{ 'about.checkNow' | translate }}
            </button>
          </div>

          <div class="flex flex-wrap gap-2">
            <a hlmBtn variant="outline" size="sm" [href]="ghReleases" target="_blank" rel="noopener">
              <ng-icon name="lucideExternalLink" class="text-base" />
              {{ 'about.githubReleases' | translate }}
            </a>
            <a hlmBtn variant="outline" size="sm" [href]="npmPage" target="_blank" rel="noopener">
              <ng-icon name="lucideExternalLink" class="text-base" />
              {{ 'about.npm' | translate }}
            </a>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <h2 class="text-base font-semibold">{{ 'about.changelog' | translate }}</h2>

        @if (updates.releases().length > 0) {
          @for (r of updates.releases(); track r.version) {
            <div hlmCard>
              <div hlmCardContent class="space-y-2 pt-5">
                <div class="flex flex-wrap items-center gap-2">
                  <a
                    [href]="r.url"
                    target="_blank"
                    rel="noopener"
                    class="text-primary text-sm font-semibold hover:underline"
                  >
                    v{{ r.version }}
                  </a>
                  @if (r.version === updates.current()) {
                    <span hlmBadge variant="secondary" class="text-xs">{{ 'about.installed' | translate }}</span>
                  }
                  @if (r.prerelease) {
                    <span hlmBadge variant="outline" class="text-xs">pre-release</span>
                  }
                  <span class="text-muted-foreground ml-auto text-xs">{{ fmtDate(r.date) }}</span>
                </div>
                @if (r.notes) {
                  <div
                    class="text-muted-foreground text-sm leading-relaxed"
                    [innerHTML]="r.notes | md"
                  ></div>
                }
              </div>
            </div>
          }
        } @else if (updates.loading()) {
          <p class="text-muted-foreground text-sm">{{ 'about.loading' | translate }}</p>
        } @else {
          <p class="text-muted-foreground text-sm">{{ 'about.noReleases' | translate }}</p>
        }
      </div>
    </div>
  `,
})
export class AboutComponent implements OnInit {
  protected readonly updates = inject(UpdatesService);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly ghReleases = GH_RELEASES;
  protected readonly npmPage = NPM_PAGE;

  constructor() {
    this.pageHeader.setPageHeader('about.title', 'about.hint');
    this.pageHeader.hideActionButton();
  }

  ngOnInit(): void {
    this.updates.ensureLoaded();
  }

  protected fmtDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }
}
