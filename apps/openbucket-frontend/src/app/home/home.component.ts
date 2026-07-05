import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideDatabase,
  lucideFile,
  lucideHardDrive,
  lucideKey,
  lucidePlus,
} from '@ng-icons/lucide';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmEmptyImports } from '@openbucket/spartan-ui/empty';

import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { StatCardComponent } from '../shared/ui/stat-card.component';
import { AreaChartComponent, AreaPoint } from '../shared/ui/area-chart.component';
import { BarChartComponent, BarDatum } from '../shared/ui/bar-chart.component';
import { BucketsSignalStore } from '../buckets/buckets.signal-store';
import { AnalyticsSignalStore } from './analytics.signal-store';
import { PageHeaderService } from '../layout/shell/services';

/** Poll interval for the dashboard analytics (>= 30s, well under the 100/min throttle). */
const POLL_MS = 30_000;

/**
 * Dashboard / home overview (STORY-0609 + STORY-1102): at-a-glance totals, recent
 * buckets, quick actions, plus usage analytics charts (storage over time, per-bucket
 * breakdown, request/error rates) driven by {@link AnalyticsSignalStore}. Polls on a
 * bounded interval that pauses while the tab is hidden.
 */
@Component({
  selector: 'ob-home',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    NgIcon,
    HlmCardImports,
    HlmButton,
    HlmEmptyImports,
    ByteSizePipe,
    RelativeTimePipe,
    StatCardComponent,
    AreaChartComponent,
    BarChartComponent,
  ],
  providers: [
    provideIcons({
      lucideActivity,
      lucideDatabase,
      lucideFile,
      lucideHardDrive,
      lucideKey,
      lucidePlus,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 p-6">
      @if (store.count() === 0 && !store.loading()) {
        <div hlm-empty>
          <div hlm-empty-header>
            <h3 hlmEmptyTitle>{{ 'dashboard.empty' | translate }}</h3>
            <p hlmEmptyDescription>{{ 'dashboard.emptyHint' | translate }}</p>
          </div>
          <a
            hlmBtn
            routerLink="/buckets"
            >{{ 'dashboard.createBucket' | translate }}</a
          >
        </div>
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ob-stat-card
            label="dashboard.totalBuckets"
            [value]="store.count()"
            icon="lucideDatabase"
            [loading]="store.loading()"
          />
          <ob-stat-card
            label="dashboard.totalObjects"
            [value]="totalObjects()"
            icon="lucideFile"
            [loading]="store.loading()"
          />
          <ob-stat-card
            label="dashboard.totalSize"
            [value]="totalSize() | byteSize"
            icon="lucideHardDrive"
            [loading]="store.loading()"
          />
          <ob-stat-card
            label="dashboard.requestRate"
            [value]="analytics.latestRequestCount()"
            icon="lucideActivity"
            [loading]="analytics.loading()"
          />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle>{{ 'dashboard.recentBuckets' | translate }}</h3>
            </div>
            <div
              hlmCardContent
              class="divide-y"
            >
              @for (b of recentBuckets(); track b.name) {
                <a
                  class="flex items-center justify-between py-2 text-sm hover:underline"
                  [routerLink]="['/buckets', b.name, 'browse']"
                >
                  <span class="font-medium">{{ b.name }}</span>
                  <span class="text-muted-foreground text-xs">{{ b.createdAt | relativeTime }}</span>
                </a>
              }
            </div>
          </div>
          <div hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle>{{ 'dashboard.quickActions' | translate }}</h3>
            </div>
            <div
              hlmCardContent
              class="flex flex-col items-start gap-2"
            >
              <a
                hlmBtn
                variant="outline"
                routerLink="/buckets"
              >
                <ng-icon
                  name="lucidePlus"
                  class="text-base"
                />
                {{ 'dashboard.createBucket' | translate }}
              </a>
              <a
                hlmBtn
                variant="outline"
                routerLink="/keys"
              >
                <ng-icon
                  name="lucideKey"
                  class="text-base"
                />
                {{ 'dashboard.createKey' | translate }}
              </a>
            </div>
          </div>
        </div>

        <!-- Usage analytics (STORY-1102) -->
        <div class="grid gap-4 md:grid-cols-2">
          <div
            hlmCard
            class="md:col-span-2"
          >
            <div hlmCardHeader class="flex-row items-center justify-between gap-2">
              <h3 hlmCardTitle>{{ 'dashboard.storageOverTime' | translate }}</h3>
              @if (analytics.storageDelta() !== 0) {
                <span class="text-muted-foreground text-xs tabular-nums">
                  {{ analytics.storageDelta() >= 0 ? '+' : '' }}{{ analytics.storageDelta() | byteSize }}
                </span>
              }
            </div>
            <div hlmCardContent>
              <ob-area-chart
                [points]="storagePoints()"
                seriesLabel="storage"
                [emptyLabel]="'dashboard.collecting' | translate"
              />
            </div>
          </div>

          <div hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle>{{ 'dashboard.bucketBreakdown' | translate }}</h3>
            </div>
            <div hlmCardContent>
              <ob-bar-chart
                [data]="breakdownData()"
                seriesLabel="bucket sizes"
                [emptyLabel]="'dashboard.collecting' | translate"
              />
            </div>
          </div>

          <div hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle>{{ 'dashboard.requestRates' | translate }}</h3>
            </div>
            <div hlmCardContent>
              <ob-area-chart
                [points]="requestPoints()"
                seriesLabel="requests"
                [emptyLabel]="'dashboard.collecting' | translate"
              />
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class HomeComponent implements OnInit, OnDestroy {
  protected readonly store = inject(BucketsSignalStore);
  protected readonly analytics = inject(AnalyticsSignalStore);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly router = inject(Router);

  private pollHandle?: ReturnType<typeof setInterval>;
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.analytics.refresh();
  };

  protected readonly totalObjects = computed(() =>
    this.store.items().reduce((sum, b) => sum + (b.objectCount ?? 0), 0),
  );
  protected readonly totalSize = computed(() =>
    this.store.items().reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0),
  );
  protected readonly recentBuckets = computed(() =>
    [...this.store.items()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
  );

  /** Storage series mapped to the area-chart point shape. */
  protected readonly storagePoints = computed<AreaPoint[]>(() =>
    this.analytics.storagePoints().map((p) => ({ t: p.t, value: p.sizeBytes })),
  );
  /** Per-bucket breakdown mapped to the bar-chart datum shape. */
  protected readonly breakdownData = computed<BarDatum[]>(() =>
    this.analytics.breakdownBuckets().map((b) => ({ label: b.name, value: b.sizeBytes })),
  );
  /** Request series mapped to total-requests-per-window for the mini area chart. */
  protected readonly requestPoints = computed<AreaPoint[]>(() =>
    this.analytics
      .requestPoints()
      .map((p) => ({ t: p.t, value: p.admin.requestCount + p.s3.requestCount })),
  );

  constructor() {
    this.pageHeader.setPageHeader('dashboard.title', 'dashboard.subtitle');
    this.pageHeader.setActionButton('dashboard.createBucket', () =>
      void this.router.navigate(['/buckets']),
    );
  }

  ngOnInit(): void {
    void this.store.refresh();
    void this.analytics.refresh();
    // Bounded polling for the analytics only (>= 30s); pause while the tab is hidden.
    this.pollHandle = setInterval(() => {
      if (document.visibilityState === 'visible') void this.analytics.refresh();
    }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy(): void {
    this.pageHeader.hideActionButton();
    if (this.pollHandle) clearInterval(this.pollHandle);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
