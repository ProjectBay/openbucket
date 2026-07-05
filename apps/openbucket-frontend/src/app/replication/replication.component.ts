import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClock, lucideDatabase, lucideLayers, lucideRefreshCw, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';

import { StatCardComponent } from '../shared/ui/stat-card.component';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { PageHeaderService } from '../layout/shell/services';
import { ReplicationSignalStore } from './replication.signal-store';

/**
 * Replication console (STORY-0902). Shows replication health (pending depth,
 * lag, failed depth) as stat cards, a per-bucket status table, and a guarded
 * "Reconcile" action that starts a backfill job and polls it to completion.
 * When no target is configured it shows a not-configured panel instead of empty
 * cards. Signals-based, OnPush, lazy-loaded — mirrors `BackupRestoreComponent`.
 */
@Component({
  selector: 'ob-replication',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    NgIcon,
    HlmCardImports,
    HlmButton,
    HlmTableImports,
    HlmBadge,
    StatCardComponent,
    ListStateComponent,
    ConfirmDialogComponent,
  ],
  providers: [
    provideIcons({ lucideClock, lucideDatabase, lucideLayers, lucideRefreshCw, lucideTriangleAlert }),
  ],
  template: `
    <div class="space-y-6 p-6">
      @if (store.status()?.enabled === false) {
        <!-- Not configured: never render zeroed cards on an instance with no target. -->
        <section hlmCard>
          <div hlmCardHeader>
            <h3 hlmCardTitle class="flex items-center gap-2">
              <ng-icon name="lucideTriangleAlert" size="18" class="text-muted-foreground" />
              {{ 'replication.disabled.title' | translate }}
            </h3>
            <p hlmCardDescription>{{ 'replication.disabled.description' | translate }}</p>
          </div>
        </section>
      } @else {
        <!-- Health stat cards -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ob-stat-card
            label="replication.stats.pending"
            icon="lucideLayers"
            [value]="store.status()?.pendingCount ?? 0"
            [loading]="store.loading() && !store.status()"
          />
          <ob-stat-card
            label="replication.stats.lag"
            icon="lucideClock"
            [value]="lagLabel()"
            [loading]="store.loading() && !store.status()"
          />
          <ob-stat-card
            label="replication.stats.failed"
            icon="lucideTriangleAlert"
            [value]="store.status()?.failedCount ?? 0"
            [loading]="store.loading() && !store.status()"
          />
        </div>

        <!-- Reconcile all -->
        <section hlmCard>
          <div hlmCardHeader>
            <h3 hlmCardTitle class="flex items-center gap-2">
              <ng-icon name="lucideRefreshCw" size="18" /> {{ 'replication.reconcile.title' | translate }}
            </h3>
            <p hlmCardDescription>{{ 'replication.reconcile.description' | translate }}</p>
          </div>
          <div hlmCardContent class="space-y-3">
            <div class="flex flex-wrap items-center gap-3">
              <button hlmBtn size="sm" [disabled]="store.reconciling()" (click)="onReconcile()">
                <ng-icon name="lucideRefreshCw" size="16" class="mr-1.5" />
                {{ 'replication.reconcile.all' | translate }}
              </button>
              @if (store.reconciling(); as running) {
                <span class="text-muted-foreground text-sm tabular-nums">
                  {{ 'replication.reconcile.progress' | translate }}:
                  {{ store.job()?.missingRequeued ?? 0 }} / {{ store.job()?.localScanned ?? 0 }}
                </span>
              }
            </div>
          </div>
        </section>

        <!-- Per-bucket table -->
        <section hlmCard>
          <div hlmCardHeader>
            <h3 hlmCardTitle>{{ 'replication.perBucket.title' | translate }}</h3>
          </div>
          <div hlmCardContent>
            <ob-list-state
              [loading]="store.loading() && !store.status()"
              [error]="store.error()"
              [empty]="(store.status()?.perBucket?.length ?? 0) === 0"
              emptyTitle="replication.perBucket.empty"
              emptyHint="replication.perBucket.emptyHint"
            >
              <div hlmTableContainer>
                <table hlmTable class="w-full">
                  <thead hlmTHead>
                    <tr hlmTr>
                      <th hlmTh>{{ 'replication.perBucket.bucket' | translate }}</th>
                      <th hlmTh class="text-right">{{ 'replication.perBucket.pending' | translate }}</th>
                      <th hlmTh class="text-right">{{ 'replication.perBucket.inflight' | translate }}</th>
                      <th hlmTh class="text-right">{{ 'replication.perBucket.failed' | translate }}</th>
                      <th hlmTh class="text-right">{{ 'replication.perBucket.lag' | translate }}</th>
                      <th hlmTh class="w-32 text-right">{{ 'replication.perBucket.actions' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (row of store.status()?.perBucket ?? []; track row.bucket) {
                      <tr hlmTr>
                        <td hlmTd class="font-medium">{{ row.bucket }}</td>
                        <td hlmTd class="text-right tabular-nums">{{ row.pendingCount }}</td>
                        <td hlmTd class="text-right tabular-nums">{{ row.inflightCount }}</td>
                        <td hlmTd class="text-right tabular-nums">
                          @if (row.failedCount > 0) {
                            <span hlmBadge variant="destructive">{{ row.failedCount }}</span>
                          } @else {
                            {{ row.failedCount }}
                          }
                        </td>
                        <td hlmTd class="text-right tabular-nums">{{ formatLag(row.oldestPendingAgeMs) }}</td>
                        <td hlmTd class="text-right">
                          <button
                            hlmBtn
                            variant="ghost"
                            size="sm"
                            [disabled]="store.reconciling()"
                            (click)="onReconcile(row.bucket)"
                          >
                            {{ 'replication.perBucket.reconcile' | translate }}
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </ob-list-state>
          </div>
        </section>
      }

      <ob-confirm-dialog
        [title]="confirmTitle()"
        [description]="confirmDesc()"
        [confirmLabel]="'replication.reconcile.confirmLabel' | translate"
      />
    </div>
  `,
})
export class ReplicationComponent implements OnInit, OnDestroy {
  protected readonly store = inject(ReplicationSignalStore);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly confirmDialog = viewChild.required(ConfirmDialogComponent);

  protected readonly confirmTitle = signal('');
  protected readonly confirmDesc = signal('');

  /** Human-readable instance-wide replication lag for the stat card. */
  protected readonly lagLabel = computed(() => this.formatLag(this.store.status()?.oldestPendingAgeMs ?? null));

  constructor() {
    this.pageHeader.setPageHeader('replication.title', 'replication.subtitle');
  }

  ngOnInit(): void {
    void this.store.refresh();
  }

  ngOnDestroy(): void {
    this.store.destroy();
  }

  /** Confirm (reconcile re-enqueues writes → guard an accidental large push). */
  protected async onReconcile(bucket?: string): Promise<void> {
    this.confirmTitle.set(bucket ? `Reconcile bucket "${bucket}"?` : 'Reconcile all buckets?');
    this.confirmDesc.set(
      bucket
        ? `This scans "${bucket}" and re-enqueues any object missing on the replication target.`
        : 'This scans every bucket and re-enqueues any object missing on the replication target. On a large instance this can push a lot of data.',
    );
    if (!(await this.confirmDialog().confirm())) return;
    await this.store.reconcile(bucket);
  }

  /** Format a lag duration (ms) as a coarse "—/Ns/Nm/Nh/Nd" string. */
  protected formatLag(ms: number | null | undefined): string {
    if (ms == null) return '—';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }
}
