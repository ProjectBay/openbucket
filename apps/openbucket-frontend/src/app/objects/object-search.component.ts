import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideSearch } from '@ng-icons/lucide';
import {
  BucketsAdminService,
  ObjectSearchHit,
  ObjectsAdminService,
} from '@openbucket/api-client';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';

import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmPaginationImports } from '@openbucket/spartan-ui/pagination';

import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { notify } from '../shared/ui/notify';

type SearchMode = 'prefix' | 'contains';
const PAGE_SIZE = 50;

/**
 * Cross-bucket object search (§STORY-1101). Signals-based, OnPush, lazy-loaded —
 * mirrors `ObjectBrowserComponent`. Drives the generated `searchObjects` method,
 * renders hits across buckets in a table with mode/bucket/tag filters, and walks
 * pages via a keyset cursor stack (the API has no OFFSET — no random page
 * access). Each row deep-links to that object's folder in the bucket browser.
 *
 * The `q` input is debounced (300ms) so keystrokes don't hammer the endpoint
 * (throttled at 100/min); `contains` submit is disabled for `q.length < 2` to
 * avoid a predictable server 400. Keys come back raw — Angular's `routerLink`/
 * `queryParams` encode once when building the browser link (the browser decodes
 * once, matching the server `decodeOnce`/`rawTail` contract). No `[innerHTML]`:
 * interpolation keeps key/tag values escaped.
 */
@Component({
  selector: 'ob-object-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    NgIcon,
    TranslateModule,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    HlmInput,
    HlmSelectImports,
    BrnSelectImports,
    HlmPaginationImports,
    ByteSizePipe,
    RelativeTimePipe,
    ListStateComponent,
  ],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideSearch })],
  template: `
    <div class="space-y-6 p-6">
      <header class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ 'search.title' | translate }}</h1>
        <p class="text-muted-foreground text-sm">{{ 'search.subtitle' | translate }}</p>
      </header>

      <div class="flex flex-wrap items-end gap-2">
        <div class="relative min-w-64 flex-1">
          <ng-icon
            name="lucideSearch"
            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-base"
          />
          <input
            hlmInput
            class="w-full pl-8"
            [placeholder]="'search.placeholder' | translate"
            [ngModel]="q()"
            (ngModelChange)="q.set($event)"
          />
        </div>

        <brn-select
          hlm
          [ngModel]="mode()"
          (ngModelChange)="onModeChange($event)"
        >
          <hlm-select-trigger class="w-40">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content>
            <hlm-option value="prefix">{{ 'search.modePrefix' | translate }}</hlm-option>
            <hlm-option value="contains">{{ 'search.modeContains' | translate }}</hlm-option>
          </hlm-select-content>
        </brn-select>

        <brn-select
          hlm
          [placeholder]="'search.allBuckets' | translate"
          [ngModel]="bucket()"
          (ngModelChange)="onBucketChange($event)"
        >
          <hlm-select-trigger class="w-48">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content>
            <hlm-option [value]="''">{{ 'search.allBuckets' | translate }}</hlm-option>
            @for (b of buckets(); track b) {
              <hlm-option [value]="b">{{ b }}</hlm-option>
            }
          </hlm-select-content>
        </brn-select>

        <input
          hlmInput
          class="w-36"
          [placeholder]="'search.tagKey' | translate"
          [ngModel]="tagKey()"
          (ngModelChange)="onTagChange('key', $event)"
        />
        <input
          hlmInput
          class="w-36"
          [placeholder]="'search.tagValue' | translate"
          [ngModel]="tagValue()"
          (ngModelChange)="onTagChange('value', $event)"
        />

        <button
          hlmBtn
          size="sm"
          [disabled]="submitDisabled()"
          (click)="submit()"
        >
          {{ 'search.search' | translate }}
        </button>
      </div>

      @if (containsTooShort()) {
        <p class="text-muted-foreground text-xs">{{ 'search.minLength' | translate }}</p>
      }

      <ob-list-state
        [loading]="loading()"
        [error]="error()"
        [empty]="results().length === 0"
        emptyTitle="search.empty"
        emptyHint="search.emptyHint"
      >
        <div hlmTableContainer>
          <table
            hlmTable
            class="w-full"
          >
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh>{{ 'search.bucket' | translate }}</th>
                <th hlmTh>{{ 'search.key' | translate }}</th>
                <th
                  hlmTh
                  class="text-right"
                >
                  {{ 'search.size' | translate }}
                </th>
                <th hlmTh>{{ 'search.modified' | translate }}</th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (hit of results(); track hit.bucket + '/' + hit.key) {
                <tr hlmTr>
                  <td hlmTd>
                    <span
                      hlmBadge
                      variant="secondary"
                      >{{ hit.bucket }}</span
                    >
                  </td>
                  <td hlmTd>
                    <a
                      class="break-all font-medium text-primary hover:underline"
                      [routerLink]="['/buckets', hit.bucket, 'browse']"
                      [queryParams]="{ prefix: prefixOf(hit.key) }"
                      >{{ hit.key }}</a
                    >
                  </td>
                  <td
                    hlmTd
                    class="text-right tabular-nums"
                  >
                    {{ hit.size | byteSize }}
                  </td>
                  <td hlmTd>{{ hit.lastModified | relativeTime }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <nav
          hlmPagination
          class="pt-3"
        >
          <ul hlmPaginationContent>
            <li hlmPaginationItem>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="gap-1 pl-2.5"
                [disabled]="!canPrev()"
                (click)="prev()"
              >
                <ng-icon
                  name="lucideChevronLeft"
                  class="text-base"
                />
                <span class="hidden sm:block">{{ 'search.previous' | translate }}</span>
              </button>
            </li>
            <li hlmPaginationItem>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="gap-1 pr-2.5"
                [disabled]="!nextCursor()"
                (click)="next()"
              >
                <span class="hidden sm:block">{{ 'search.next' | translate }}</span>
                <ng-icon
                  name="lucideChevronRight"
                  class="text-base"
                />
              </button>
            </li>
          </ul>
        </nav>
      </ob-list-state>
    </div>
  `,
})
export class ObjectSearchComponent implements OnInit {
  private readonly api = inject(ObjectsAdminService);
  private readonly buckets$ = inject(BucketsAdminService);
  private readonly destroyRef = inject(DestroyRef);

  readonly q = signal('');
  readonly mode = signal<SearchMode>('prefix');
  readonly bucket = signal<string>(''); // '' → all buckets
  readonly tagKey = signal('');
  readonly tagValue = signal('');
  readonly buckets = signal<string[]>([]);

  readonly results = signal<ObjectSearchHit[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly nextCursor = signal<string | undefined>(undefined);

  /** Keyset page stack: each entry is the cursor that produced that page. */
  private cursors: (string | undefined)[] = [undefined];

  /** `contains` needs >= 2 chars (mirrors the server refinement + DoS guard). */
  readonly containsTooShort = computed(
    () => this.mode() === 'contains' && this.q().trim().length > 0 && this.q().trim().length < 2,
  );
  readonly submitDisabled = computed(() => {
    const term = this.q().trim();
    if (term.length === 0) return true;
    return this.mode() === 'contains' && term.length < 2;
  });

  ngOnInit(): void {
    void this.loadBuckets();
    // Debounce keystrokes so a fast typist doesn't hammer the throttled endpoint.
    toObservable(this.q)
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.submit());
  }

  canPrev(): boolean {
    return this.cursors.length > 1;
  }

  /** Parent folder of a key (the browser lists this prefix). '' for a root key. */
  prefixOf(key: string): string {
    const idx = key.lastIndexOf('/');
    return idx === -1 ? '' : key.slice(0, idx + 1);
  }

  onModeChange(mode: SearchMode): void {
    this.mode.set(mode);
    this.submit();
  }

  onBucketChange(bucket: string): void {
    this.bucket.set(bucket ?? '');
    this.submit();
  }

  onTagChange(field: 'key' | 'value', value: string): void {
    if (field === 'key') this.tagKey.set(value);
    else this.tagValue.set(value);
    this.submit();
  }

  /** Run a fresh search from page 1 (resets the keyset cursor stack). */
  submit(): void {
    this.cursors = [undefined];
    void this.fetch(undefined);
  }

  next(): void {
    const cursor = this.nextCursor();
    if (!cursor) return;
    this.cursors.push(cursor);
    void this.fetch(cursor);
  }

  prev(): void {
    if (this.cursors.length <= 1) return;
    this.cursors.pop();
    void this.fetch(this.cursors[this.cursors.length - 1]);
  }

  private async loadBuckets(): Promise<void> {
    try {
      const res = await firstValueFrom(this.buckets$.listBuckets());
      this.buckets.set((res?.buckets ?? []).map((b) => b.name));
    } catch {
      /* the bucket filter is optional; leave it empty */
    }
  }

  private async fetch(cursor: string | undefined): Promise<void> {
    const term = this.q().trim();
    // Empty q clears results without a call; a too-short `contains` term is a no-op.
    if (!term || (this.mode() === 'contains' && term.length < 2)) {
      this.results.set([]);
      this.nextCursor.set(undefined);
      return;
    }
    // tagKey/tagValue must travel together (server refinement) — only send a full pair.
    const tk = this.tagKey().trim();
    const tv = this.tagValue().trim();
    const [tagKey, tagValue] = tk && tv ? [tk, tv] : [undefined, undefined];

    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.api.searchObjects(
          term,
          this.mode(),
          this.bucket() || undefined,
          tagKey,
          tagValue,
          cursor,
          PAGE_SIZE,
        ),
      );
      this.results.set(res?.results ?? []);
      this.nextCursor.set(res?.isTruncated ? res?.nextCursor : undefined);
    } catch {
      this.error.set('Search failed.');
      notify.error('Search failed');
    } finally {
      this.loading.set(false);
    }
  }
}
