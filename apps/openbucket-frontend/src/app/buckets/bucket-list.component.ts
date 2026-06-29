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
import { HlmSkeleton } from '@openbucket/spartan-ui/skeleton';
import { HlmEmptyImports } from '@openbucket/spartan-ui/empty';
import { HlmButton } from '@openbucket/spartan-ui/button';

import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { notify } from '../shared/ui/notify';
import { PageHeaderService } from '../layout/shell/services';
import { BucketsSignalStore } from './buckets.signal-store';
import { BucketCreateDialogComponent } from './bucket-create-dialog.component';

/**
 * Bucket list (STORY-0603) on spartan-ng: HlmTable, status badges, skeleton /
 * empty states, a create dialog and a type-to-confirm delete, all wired to the
 * shared UX kit (notify / confirm-dialog). Title + Create action render through
 * the unified page header (PageHeaderService).
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
    HlmSkeleton,
    HlmEmptyImports,
    HlmButton,
    ByteSizePipe,
    RelativeTimePipe,
    ConfirmDialogComponent,
    BucketCreateDialogComponent,
  ],
  providers: [provideIcons({ lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6">
      @if (store.loading()) {
        <div class="space-y-2">
          @for (r of skeletonRows; track r) {
            <div
              hlmSkeleton
              class="h-12 w-full rounded-md"
            ></div>
          }
        </div>
      } @else if (store.error()) {
        <p class="text-sm font-medium text-destructive">{{ store.error() }}</p>
      } @else if (store.count() === 0) {
        <div hlm-empty>
          <div hlm-empty-header>
            <h3 hlmEmptyTitle>{{ 'buckets.empty' | translate }}</h3>
            <p hlmEmptyDescription>{{ 'buckets.emptyHint' | translate }}</p>
          </div>
          <button
            hlmBtn
            (click)="createDialog().open()"
          >
            {{ 'buckets.create' | translate }}
          </button>
        </div>
      } @else {
        <div hlmTableContainer>
          <table
            hlmTable
            class="w-full"
          >
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh>{{ 'buckets.name' | translate }}</th>
                <th hlmTh>{{ 'buckets.status' | translate }}</th>
                <th
                  hlmTh
                  class="text-right"
                >
                  {{ 'buckets.objects' | translate }}
                </th>
                <th
                  hlmTh
                  class="text-right"
                >
                  {{ 'buckets.size' | translate }}
                </th>
                <th hlmTh>{{ 'buckets.created' | translate }}</th>
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
      }
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

  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly deleteName = signal<string | null>(null);

  protected readonly sorted = computed(() =>
    [...this.store.items()].sort((a, b) => a.name.localeCompare(b.name)),
  );
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
