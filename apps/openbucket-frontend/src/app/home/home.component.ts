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
import { BucketsSignalStore } from '../buckets/buckets.signal-store';
import { PageHeaderService } from '../layout/shell/services';

/**
 * Dashboard / home overview (STORY-0609): at-a-glance totals (from the bucket
 * store), recent buckets, and quick actions. Reuses the data the bucket list
 * already loads.
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
  ],
  providers: [
    provideIcons({ lucideDatabase, lucideFile, lucideHardDrive, lucideKey, lucidePlus }),
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
        <div class="grid gap-4 sm:grid-cols-3">
          <div hlmCard>
            <div
              hlmCardHeader
              class="flex-row items-center justify-between gap-2 pb-2"
            >
              <span hlmCardDescription>{{ 'dashboard.totalBuckets' | translate }}</span>
              <ng-icon
                name="lucideDatabase"
                class="text-muted-foreground text-base"
              />
            </div>
            <div hlmCardContent>
              <p class="text-2xl font-semibold tabular-nums">{{ store.count() }}</p>
            </div>
          </div>
          <div hlmCard>
            <div
              hlmCardHeader
              class="flex-row items-center justify-between gap-2 pb-2"
            >
              <span hlmCardDescription>{{ 'dashboard.totalObjects' | translate }}</span>
              <ng-icon
                name="lucideFile"
                class="text-muted-foreground text-base"
              />
            </div>
            <div hlmCardContent>
              <p class="text-2xl font-semibold tabular-nums">{{ totalObjects() }}</p>
            </div>
          </div>
          <div hlmCard>
            <div
              hlmCardHeader
              class="flex-row items-center justify-between gap-2 pb-2"
            >
              <span hlmCardDescription>{{ 'dashboard.totalSize' | translate }}</span>
              <ng-icon
                name="lucideHardDrive"
                class="text-muted-foreground text-base"
              />
            </div>
            <div hlmCardContent>
              <p class="text-2xl font-semibold tabular-nums">{{ totalSize() | byteSize }}</p>
            </div>
          </div>
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
      }
    </div>
  `,
})
export class HomeComponent implements OnInit, OnDestroy {
  protected readonly store = inject(BucketsSignalStore);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly router = inject(Router);

  protected readonly totalObjects = computed(() =>
    this.store.items().reduce((sum, b) => sum + (b.objectCount ?? 0), 0),
  );
  protected readonly totalSize = computed(() =>
    this.store.items().reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0),
  );
  protected readonly recentBuckets = computed(() =>
    [...this.store.items()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
  );

  constructor() {
    this.pageHeader.setPageHeader('dashboard.title', 'dashboard.subtitle');
    this.pageHeader.setActionButton('dashboard.createBucket', () =>
      void this.router.navigate(['/buckets']),
    );
  }

  ngOnInit(): void {
    void this.store.refresh();
  }

  ngOnDestroy(): void {
    this.pageHeader.hideActionButton();
  }
}
