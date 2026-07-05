import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleCheck,
  lucideRefreshCw,
  lucideShieldCheck,
  lucideTriangleAlert,
  lucideWrench,
} from '@ng-icons/lucide';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmTableImports } from '@openbucket/spartan-ui/table';

import { StatCardComponent } from '../shared/ui/stat-card.component';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { IntegritySignalStore } from './integrity.signal-store';

/**
 * Integrity console (STORY-1204). Shows scrub health (scanned / ok / corrupt /
 * repaired) as stat cards, a corrupt-object table, and a guarded "Scrub now"
 * action. When nothing is corrupt it shows a clean panel instead of an empty
 * table. Signals-based, OnPush, lazy-loaded — mirrors `ReplicationComponent`.
 * Read-only routes surface counts + object identities only — never a target
 * endpoint or credential.
 */
@Component({
  selector: 'ob-integrity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    NgIcon,
    HlmCardImports,
    HlmButton,
    HlmTableImports,
    StatCardComponent,
    ListStateComponent,
  ],
  providers: [
    provideIcons({
      lucideCircleCheck,
      lucideRefreshCw,
      lucideShieldCheck,
      lucideTriangleAlert,
      lucideWrench,
    }),
  ],
  template: `
    <div class="space-y-6 p-6">
      <!-- Health stat cards -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ob-stat-card
          label="integrity.stats.scanned"
          icon="lucideShieldCheck"
          [value]="store.status()?.scanned ?? 0"
          [loading]="store.loading() && !store.status()"
        />
        <ob-stat-card
          label="integrity.stats.ok"
          icon="lucideCircleCheck"
          [value]="store.status()?.ok ?? 0"
          [loading]="store.loading() && !store.status()"
        />
        <ob-stat-card
          label="integrity.stats.corrupt"
          icon="lucideTriangleAlert"
          [value]="store.status()?.corrupt ?? 0"
          [loading]="store.loading() && !store.status()"
        />
        <ob-stat-card
          label="integrity.stats.repaired"
          icon="lucideWrench"
          [value]="store.status()?.repaired ?? 0"
          [loading]="store.loading() && !store.status()"
        />
      </div>

      <!-- Scrub now -->
      <section hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle class="flex items-center gap-2">
            <ng-icon name="lucideRefreshCw" size="18" /> {{ 'integrity.scrub.title' | translate }}
          </h3>
          <p hlmCardDescription>{{ 'integrity.scrub.description' | translate }}</p>
        </div>
        <div hlmCardContent class="space-y-3">
          <div class="flex flex-wrap items-center gap-3">
            <button hlmBtn size="sm" [disabled]="store.scrubbing()" (click)="onScrub()">
              <ng-icon name="lucideRefreshCw" size="16" class="mr-1.5" />
              {{ 'integrity.scrub.now' | translate }}
            </button>
            @if (store.status()?.enabled === false) {
              <span class="text-muted-foreground text-sm">
                {{ 'integrity.scrub.disabledHint' | translate }}
              </span>
            }
          </div>
        </div>
      </section>

      <!-- Corrupt list, or a clean panel when there is no corruption -->
      @if (!store.hasCorruption() && !store.loading()) {
        <section hlmCard>
          <div hlmCardHeader>
            <h3 hlmCardTitle class="flex items-center gap-2">
              <ng-icon name="lucideCircleCheck" size="18" class="text-muted-foreground" />
              {{ 'integrity.clean.title' | translate }}
            </h3>
            <p hlmCardDescription>{{ 'integrity.clean.description' | translate }}</p>
          </div>
        </section>
      } @else {
        <section hlmCard>
          <div hlmCardHeader>
            <h3 hlmCardTitle>{{ 'integrity.corrupt.title' | translate }}</h3>
          </div>
          <div hlmCardContent>
            <ob-list-state
              [loading]="store.loading() && store.corruptRows().length === 0"
              [error]="store.error()"
              [empty]="store.corruptRows().length === 0"
              emptyTitle="integrity.corrupt.empty"
              emptyHint="integrity.corrupt.emptyHint"
            >
              <div hlmTableContainer>
                <table hlmTable class="w-full">
                  <thead hlmTHead>
                    <tr hlmTr>
                      <th hlmTh>{{ 'integrity.corrupt.bucket' | translate }}</th>
                      <th hlmTh>{{ 'integrity.corrupt.key' | translate }}</th>
                      <th hlmTh>{{ 'integrity.corrupt.checkedAt' | translate }}</th>
                      <th hlmTh>{{ 'integrity.corrupt.detail' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (row of store.corruptRows(); track row.bucket + '/' + row.key) {
                      <tr hlmTr>
                        <td hlmTd class="font-medium">{{ row.bucket }}</td>
                        <td hlmTd class="max-w-xs truncate" [title]="row.key">{{ row.key }}</td>
                        <td hlmTd class="tabular-nums">{{ formatDate(row.checkedAt) }}</td>
                        <td hlmTd class="text-muted-foreground max-w-xs truncate" [title]="row.detail ?? ''">
                          {{ row.detail ?? '—' }}
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
    </div>
  `,
})
export class IntegrityComponent implements OnInit {
  protected readonly store = inject(IntegritySignalStore);

  ngOnInit(): void {
    void this.store.refresh();
  }

  protected async onScrub(): Promise<void> {
    await this.store.scrubNow();
  }

  /** Format an ISO timestamp for the table (locale date-time, or "—" when null). */
  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
}
