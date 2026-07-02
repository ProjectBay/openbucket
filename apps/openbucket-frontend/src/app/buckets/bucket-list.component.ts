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
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2 } from '@ng-icons/lucide';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';

import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { SortHeaderComponent, type SortDir } from '../shared/ui/sort-header.component';
import { notify } from '../shared/ui/notify';
import { PageHeaderService } from '../layout/shell/services';
import { BucketsSignalStore } from './buckets.signal-store';
import { BucketCreateDialogComponent } from './bucket-create-dialog.component';

type BucketSortKey = 'name' | 'objects' | 'size' | 'created';

/**
 * Bucket list (STORY-0603) on spartan-ng: HlmTable, sortable headers, status
 * badges, shared list-state (skeleton / error / empty), a create dialog and a
 * type-to-confirm delete, all wired to the shared UX kit (notify /
 * confirm-dialog). Title + Create action render through the unified page header.
 */
@Component({
  standalone: true,
  selector: 'ob-bucket-list',
  imports: [
    RouterLink,
    TranslateModule,
    NgIcon,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    ByteSizePipe,
    RelativeTimePipe,
    ConfirmDialogComponent,
    ListStateComponent,
    SortHeaderComponent,
    BucketCreateDialogComponent,
  ],
  providers: [provideIcons({ lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6">
      <ob-list-state
        [loading]="store.loading()"
        [error]="store.error()"
        [empty]="store.count() === 0"
        emptyTitle="buckets.empty"
        emptyHint="buckets.emptyHint"
      >
        <button
          listEmptyAction
          hlmBtn
          (click)="createDialog().open()"
        >
          {{ 'buckets.create' | translate }}
        </button>
        <div hlmTableContainer>
          <table
            hlmTable
            class="w-full"
          >
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh>
                  <ob-sort-header
                    label="buckets.name"
                    [active]="sortKey() === 'name'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('name')"
                  />
                </th>
                <th hlmTh>{{ 'buckets.status' | translate }}</th>
                <th
                  hlmTh
                  class="text-right"
                >
                  <ob-sort-header
                    label="buckets.objects"
                    [active]="sortKey() === 'objects'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('objects')"
                  />
                </th>
                <th
                  hlmTh
                  class="text-right"
                >
                  <ob-sort-header
                    label="buckets.size"
                    [active]="sortKey() === 'size'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('size')"
                  />
                </th>
                <th hlmTh>
                  <ob-sort-header
                    label="buckets.created"
                    [active]="sortKey() === 'created'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('created')"
                  />
                </th>
                <th
                  hlmTh
                  class="w-12 text-right"
                >
                  {{ 'buckets.actions' | translate }}
                </th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (b of sorted(); track b.name) {
                <tr hlmTr>
                  <td hlmTd>
                    <a
                      class="font-medium text-primary hover:underline"
                      [routerLink]="['/buckets', b.name]"
                      >{{ b.name }}</a
                    >
                  </td>
                  <td hlmTd>
                    <span
                      hlmBadge
                      [variant]="b.versioning === 'enabled' ? 'default' : 'secondary'"
                      >{{ b.versioning }}</span
                    >
                    @if (b.objectLock) {
                      <span
                        hlmBadge
                        variant="outline"
                        class="ml-1"
                        >{{ 'buckets.lock' | translate }}</span
                      >
                    }
                  </td>
                  <td
                    hlmTd
                    class="text-right tabular-nums"
                  >
                    {{ b.objectCount }}
                  </td>
                  <td
                    hlmTd
                    class="text-right tabular-nums"
                  >
                    {{ b.sizeBytes | byteSize }}
                  </td>
                  <td hlmTd>{{ b.createdAt | relativeTime }}</td>
                  <td
                    hlmTd
                    class="text-right"
                  >
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      [attr.aria-label]="'Delete ' + b.name"
                      (click)="onDelete(b.name)"
                    >
                      <ng-icon
                        name="lucideTrash2"
                        class="text-base"
                      />
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ob-list-state>
    </div>

    <ob-bucket-create-dialog />
    <ob-confirm-dialog
      [title]="'buckets.deleteTitle' | translate"
      [description]="deleteDescription()"
      [confirmLabel]="'buckets.delete' | translate"
      [destructive]="true"
      [confirmPhrase]="deleteName()"
    />
  `,
})
export class BucketListComponent implements OnInit, OnDestroy {
  protected readonly store = inject(BucketsSignalStore);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly createDialog = viewChild.required(BucketCreateDialogComponent);
  protected readonly confirmDialog = viewChild.required(ConfirmDialogComponent);

  protected readonly deleteName = signal<string | null>(null);
  protected readonly sortKey = signal<BucketSortKey>('name');
  protected readonly sortDir = signal<SortDir>('asc');

  protected readonly sorted = computed(() => {
    const key = this.sortKey();
    const factor = this.sortDir() === 'asc' ? 1 : -1;
    return [...this.store.items()].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'objects':
          cmp = (a.objectCount ?? 0) - (b.objectCount ?? 0);
          break;
        case 'size':
          cmp = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
          break;
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return cmp * factor;
    });
  });
  protected readonly deleteDescription = computed(
    () =>
      `This permanently deletes "${this.deleteName() ?? ''}" and cannot be undone. The bucket must be empty.`,
  );

  constructor() {
    this.pageHeader.setPageHeader('buckets.title');
    this.pageHeader.setActionButton('buckets.create', () => this.createDialog().open());
  }

  ngOnInit(): void {
    void this.store.refresh();
  }

  ngOnDestroy(): void {
    this.pageHeader.hideActionButton();
  }

  protected toggleSort(key: BucketSortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  protected async onDelete(name: string): Promise<void> {
    this.deleteName.set(name);
    const ok = await this.confirmDialog().confirm();
    if (!ok) return;
    try {
      await this.store.remove(name);
      notify.success(`Bucket "${name}" deleted`);
    } catch {
      notify.error('Failed to delete bucket');
    }
  }
}
