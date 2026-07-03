import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
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

interface ReleaseInfo {
  version: string; // tag without the `nestjs-v` prefix
  name: string;
  date: string; // ISO
  notes: string; // markdown body (rendered as plain pre-wrapped text)
  url: string;
  prerelease: boolean;
}

const REPO = 'ProjectBay/openbucket';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const GH_RELEASES = `https://github.com/${REPO}/releases`;
const NPM_PAGE = 'https://www.npmjs.com/package/@openbucket/nestjs';

/** Compare two semver-lite strings (`X.Y.Z` or `X.Y.Z-alpha.N`). Returns >0 if a > b. */
function cmpVersion(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-');
    const [maj = 0, min = 0, pat = 0] = core.split('.').map(Number);
    return { maj, min, pat, pre };
  };
  const A = parse(a);
  const B = parse(b);
  if (A.maj !== B.maj) return A.maj - B.maj;
  if (A.min !== B.min) return A.min - B.min;
  if (A.pat !== B.pat) return A.pat - B.pat;
  if (!A.pre && B.pre) return 1; // stable > prerelease
  if (A.pre && !B.pre) return -1;
  if (!A.pre && !B.pre) return 0;
  const as = A.pre.split('.');
  const bs = B.pre.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * About / updates card: shows the running OpenBucket version (from the admin API),
 * checks GitHub Releases for a newer `nestjs-v*` release, and lists past release
 * notes. GitHub is fetched with the native `fetch` (not HttpClient) so the admin
 * JWT is never attached to a cross-origin request; failures degrade gracefully to
 * "couldn't check" with the manual links still shown.
 */
@Component({
  selector: 'ob-about-updates',
  standalone: true,
  imports: [TranslateModule, NgIcon, HlmCardImports, HlmButton, HlmBadge],
  providers: [
    provideIcons({ lucideCircleArrowUp, lucideCircleCheck, lucideExternalLink, lucideRefreshCw }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmCard>
      <div hlmCardHeader>
        <h3 hlmCardTitle>{{ 'about.title' | translate }}</h3>
        <p hlmCardDescription>{{ 'about.hint' | translate }}</p>
      </div>
      <div hlmCardContent class="space-y-5">
        <!-- current version + update status -->
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{{ 'about.currentVersion' | translate }}</span>
            <span hlmBadge variant="secondary" class="font-mono">
              {{ current() ? 'v' + current() : '—' }}
            </span>
          </div>

          @if (updateAvailable()) {
            <a
              hlmBadge
              [href]="latestUrl()"
              target="_blank"
              rel="noopener"
              class="gap-1"
            >
              <ng-icon name="lucideCircleArrowUp" class="text-sm" />
              {{ 'about.updateAvailable' | translate }} v{{ latest() }}
            </a>
          } @else if (latest() && !checkFailed()) {
            <span hlmBadge variant="outline" class="text-muted-foreground gap-1">
              <ng-icon name="lucideCircleCheck" class="text-sm" />
              {{ 'about.upToDate' | translate }}
            </span>
          } @else if (checkFailed()) {
            <span class="text-muted-foreground text-xs">{{ 'about.checkFailed' | translate }}</span>
          }

          <button
            hlmBtn
            variant="ghost"
            size="sm"
            class="ml-auto"
            [disabled]="loading()"
            (click)="check()"
          >
            <ng-icon name="lucideRefreshCw" class="text-base" [class.animate-spin]="loading()" />
            {{ 'about.checkNow' | translate }}
          </button>
        </div>

        <!-- links -->
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

        <!-- changelog / past releases -->
        <div class="space-y-2">
          <span class="text-sm font-medium">{{ 'about.changelog' | translate }}</span>
          @if (releases().length > 0) {
            <div class="max-h-96 space-y-3 overflow-auto rounded-md border p-1">
              @for (r of releases(); track r.version) {
                <div class="rounded-md p-3" [class.bg-muted]="r.version === current()">
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <a
                      [href]="r.url"
                      target="_blank"
                      rel="noopener"
                      class="text-primary font-medium hover:underline"
                    >
                      v{{ r.version }}
                    </a>
                    @if (r.version === current()) {
                      <span hlmBadge variant="secondary" class="text-xs">{{ 'about.installed' | translate }}</span>
                    }
                    @if (r.prerelease) {
                      <span hlmBadge variant="outline" class="text-xs">pre-release</span>
                    }
                    <span class="text-muted-foreground ml-auto text-xs">{{ fmtDate(r.date) }}</span>
                  </div>
                  @if (r.notes) {
                    <pre class="text-muted-foreground max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">{{ r.notes }}</pre>
                  }
                </div>
              }
            </div>
          } @else if (loading()) {
            <p class="text-muted-foreground text-sm">{{ 'about.loading' | translate }}</p>
          } @else {
            <p class="text-muted-foreground text-sm">{{ 'about.noReleases' | translate }}</p>
          }
        </div>
      </div>
    </div>
  `,
})
export class AboutUpdatesComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly ghReleases = GH_RELEASES;
  protected readonly npmPage = NPM_PAGE;

  protected readonly current = signal<string | null>(null);
  protected readonly releases = signal<ReleaseInfo[]>([]);
  protected readonly loading = signal(false);
  protected readonly checkFailed = signal(false);

  protected readonly latest = computed(() => this.releases()[0]?.version ?? null);
  protected readonly latestUrl = computed(() => this.releases()[0]?.url ?? GH_RELEASES);
  protected readonly updateAvailable = computed(() => {
    const cur = this.current();
    const lat = this.latest();
    return !!cur && !!lat && cmpVersion(lat, cur) > 0;
  });

  ngOnInit(): void {
    void this.check();
  }

  protected fmtDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  }

  protected async check(): Promise<void> {
    this.loading.set(true);
    this.checkFailed.set(false);
    await Promise.all([this.loadVersion(), this.loadReleases()]);
    this.loading.set(false);
  }

  private async loadVersion(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ version: string }>('/api/admin/version'),
      );
      this.current.set(res.version);
    } catch {
      // leave current() null — the endpoint may be older than this console
    }
  }

  private async loadReleases(): Promise<void> {
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const data: Array<{
        tag_name: string;
        name: string | null;
        body: string | null;
        published_at: string;
        html_url: string;
        prerelease: boolean;
        draft: boolean;
      }> = await res.json();
      const releases = data
        .filter((r) => !r.draft && r.tag_name?.startsWith('nestjs-v'))
        .map((r) => ({
          version: r.tag_name.replace(/^nestjs-v/, ''),
          name: r.name || r.tag_name,
          date: r.published_at,
          notes: (r.body || '').trim(),
          url: r.html_url,
          prerelease: r.prerelease,
        }));
      this.releases.set(releases);
    } catch {
      this.checkFailed.set(true);
    }
  }
}
