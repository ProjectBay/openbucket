import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { BrnSelectImports } from '@spartan-ng/brain/select';

import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { CopyButtonComponent } from '../shared/ui/copy-button.component';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { PageHeaderService } from '../layout/shell/services';
import { AuditSignalStore } from './audit.signal-store';

/** ISO 8601 → the value a `datetime-local` input expects (`YYYY-MM-DDTHH:mm`,
 *  local time). Empty for an absent/invalid value. */
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value → ISO 8601 (UTC, `Z`) the API's `z.string().datetime()`
 *  accepts. undefined for an empty/invalid value. */
function localInputToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Audit-log viewer (§5.9, STORY-1103). Signals-based, OnPush, lazy-loaded —
 * mirrors `ObjectSearchComponent`/`KeysListComponent`. A filter bar (event
 * dropdown from the catalogue, actor/bucket text inputs, from/to datetimes)
 * drives {@link AuditSignalStore.refresh}; a keyset "Load more" pager appends
 * pages. `detail` is rendered via the `json` pipe (interpolation, never
 * `innerHTML`) so stored values can't inject markup.
 */
@Component({
  selector: 'ob-audit-log',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslateModule,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    HlmInput,
    HlmSelectImports,
    BrnSelectImports,
    RelativeTimePipe,
    CopyButtonComponent,
    ListStateComponent,
  ],
  template: `
    <div class="space-y-6 p-6">
      <div class="flex flex-wrap items-end gap-2">
        <brn-select
          hlm
          [placeholder]="'audit.allEvents' | translate"
          [ngModel]="event()"
          (ngModelChange)="event.set($event)"
        >
          <hlm-select-trigger class="w-56">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content>
            <hlm-option [value]="''">{{ 'audit.allEvents' | translate }}</hlm-option>
            @for (e of store.catalog(); track e) {
              <hlm-option [value]="e">{{ e }}</hlm-option>
            }
          </hlm-select-content>
        </brn-select>

        <input
          hlmInput
          class="w-40"
          [placeholder]="'audit.actor' | translate"
          [ngModel]="subject()"
          (ngModelChange)="subject.set($event)"
        />
        <input
          hlmInput
          class="w-40"
          [placeholder]="'audit.bucket' | translate"
          [ngModel]="bucket()"
          (ngModelChange)="bucket.set($event)"
        />

        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground text-xs">{{ 'audit.from' | translate }}</span>
          <input
            hlmInput
            type="datetime-local"
            class="w-52"
            [ngModel]="from()"
            (ngModelChange)="from.set($event)"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-muted-foreground text-xs">{{ 'audit.to' | translate }}</span>
          <input
            hlmInput
            type="datetime-local"
            class="w-52"
            [ngModel]="to()"
            (ngModelChange)="to.set($event)"
          />
        </label>

        <button
          hlmBtn
          size="sm"
          [disabled]="store.loading()"
          (click)="applyFilters()"
        >
          {{ 'audit.filter' | translate }}
        </button>
        <button
          hlmBtn
          variant="ghost"
          size="sm"
          [disabled]="store.loading()"
          (click)="clearFilters()"
        >
          {{ 'audit.clear' | translate }}
        </button>
      </div>

      <ob-list-state
        [loading]="store.loading() && store.count() === 0"
        [error]="store.error()"
        [empty]="store.count() === 0"
        emptyTitle="audit.empty"
        emptyHint="audit.emptyHint"
        [skeletonCount]="6"
      >
        <div hlmTableContainer>
          <table
            hlmTable
            class="w-full"
          >
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh>{{ 'audit.time' | translate }}</th>
                <th hlmTh>{{ 'audit.event' | translate }}</th>
                <th hlmTh>{{ 'audit.actor' | translate }}</th>
                <th hlmTh>{{ 'audit.target' | translate }}</th>
                <th hlmTh>{{ 'audit.ip' | translate }}</th>
                <th hlmTh>{{ 'audit.request' | translate }}</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (ev of store.items(); track ev.id) {
                <tr hlmTr>
                  <td
                    hlmTd
                    [title]="ev.ts"
                  >
                    {{ ev.ts | relativeTime }}
                  </td>
                  <td hlmTd>
                    <span
                      hlmBadge
                      variant="secondary"
                      >{{ ev.event }}</span
                    >
                  </td>
                  <td hlmTd>
                    {{ ev.subject || '—' }}
                  </td>
                  <td hlmTd>
                    <span class="break-all">{{ targetOf(ev) }}</span>
                  </td>
                  <td hlmTd>
                    <code class="font-mono text-xs">{{ ev.ip || '—' }}</code>
                  </td>
                  <td hlmTd>
                    @if (ev.requestId) {
                      <div class="flex items-center gap-1">
                        <code class="font-mono text-xs">{{ ev.requestId }}</code>
                        <ob-copy-button
                          [value]="ev.requestId"
                          label="Copy request ID"
                        />
                      </div>
                    } @else {
                      <span class="text-muted-foreground">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (store.hasMore()) {
          <div class="flex justify-center pt-4">
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="store.loading()"
              (click)="store.loadMore()"
            >
              {{ 'audit.loadMore' | translate }}
            </button>
          </div>
        }
      </ob-list-state>
    </div>
  `,
})
export class AuditLogComponent implements OnInit {
  protected readonly store = inject(AuditSignalStore);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly event = signal('');
  protected readonly subject = signal('');
  protected readonly bucket = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');

  constructor() {
    this.pageHeader.setPageHeader('audit.title', 'audit.subtitle');
    // Hydrate the local controls from any preserved store filters (route re-entry).
    const f = this.store.filters();
    this.event.set(f.event ?? '');
    this.subject.set(f.subject ?? '');
    this.bucket.set(f.bucket ?? '');
    this.from.set(isoToLocalInput(f.from));
    this.to.set(isoToLocalInput(f.to));
  }

  ngOnInit(): void {
    void this.store.loadCatalog();
    void this.store.refresh();
  }

  /** The most specific target for the row: `bucket/objectKey`, bucket, or keyId. */
  protected targetOf(ev: {
    bucket: string | null;
    objectKey: string | null;
    keyId: string | null;
  }): string {
    if (ev.bucket && ev.objectKey) return `${ev.bucket}/${ev.objectKey}`;
    return ev.bucket || ev.keyId || '—';
  }

  protected applyFilters(): void {
    this.store.filters.set({
      event: this.event() || undefined,
      subject: this.subject().trim() || undefined,
      bucket: this.bucket().trim() || undefined,
      from: localInputToIso(this.from()),
      to: localInputToIso(this.to()),
    });
    void this.store.refresh();
  }

  protected clearFilters(): void {
    this.event.set('');
    this.subject.set('');
    this.bucket.set('');
    this.from.set('');
    this.to.set('');
    this.store.filters.set({});
    void this.store.refresh();
  }
}
