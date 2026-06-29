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
import { lucideEllipsisVertical, lucideTrash2 } from '@ng-icons/lucide';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';
import { HlmSkeleton } from '@openbucket/spartan-ui/skeleton';
import { HlmEmptyImports } from '@openbucket/spartan-ui/empty';
import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';
import { CreatedKeyDto, KeySummaryDto } from '@openbucket/api-client';

import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { CopyButtonComponent } from '../shared/ui/copy-button.component';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { notify } from '../shared/ui/notify';
import { PageHeaderService } from '../layout/shell/services';
import { KeysSignalStore } from './keys.signal-store';
import { KeyCreateDialogComponent } from './key-create-dialog.component';
import { KeySecretOnceDialogComponent } from './key-secret-once-dialog.component';

/**
 * Access-keys management (STORY-0611): list/create/enable-disable/delete on
 * spartan-ng, with a one-time secret reveal. Title + Create action via the
 * unified page header.
 */
@Component({
  selector: 'ob-keys-list',
  standalone: true,
  imports: [
    TranslateModule,
    NgIcon,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    HlmSwitch,
    HlmSkeleton,
    HlmEmptyImports,
    HlmDropdownMenuImports,
    RelativeTimePipe,
    CopyButtonComponent,
    ConfirmDialogComponent,
    KeyCreateDialogComponent,
    KeySecretOnceDialogComponent,
  ],
  providers: [provideIcons({ lucideEllipsisVertical, lucideTrash2 })],
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
        <p class="text-destructive text-sm font-medium">{{ store.error() }}</p>
      } @else if (store.count() === 0) {
        <div hlm-empty>
          <div hlm-empty-header>
            <h3 hlmEmptyTitle>{{ 'keys.empty' | translate }}</h3>
            <p hlmEmptyDescription>{{ 'keys.emptyHint' | translate }}</p>
          </div>
          <button
            hlmBtn
            (click)="createDialog().open()"
          >
            {{ 'keys.create' | translate }}
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
                <th hlmTh>{{ 'keys.label' | translate }}</th>
                <th hlmTh>{{ 'keys.accessKeyId' | translate }}</th>
                <th hlmTh>{{ 'keys.role' | translate }}</th>
                <th hlmTh>{{ 'keys.lastUsed' | translate }}</th>
                <th hlmTh>{{ 'keys.enabled' | translate }}</th>
                <th
                  hlmTh
                  class="w-12 text-right"
                >
                  {{ 'keys.actions' | translate }}
                </th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (k of store.items(); track k.id) {
                <tr hlmTr>
                  <td
                    hlmTd
                    class="font-medium"
                  >
                    {{ k.label }}
                  </td>
                  <td hlmTd>
                    <div class="flex items-center gap-1">
                      <code class="font-mono text-xs">{{ k.accessKeyId }}</code>
                      <ob-copy-button
                        [value]="k.accessKeyId"
                        label="Copy access key ID"
                      />
                    </div>
                  </td>
                  <td hlmTd>
                    <span
                      hlmBadge
                      variant="secondary"
                      >{{ k.role }}</span
                    >
                  </td>
                  <td hlmTd>
                    @if (k.lastUsedAt) {
                      {{ k.lastUsedAt | relativeTime }}
                    } @else {
                      <span class="text-muted-foreground">{{ 'keys.never' | translate }}</span>
                    }
                  </td>
                  <td hlmTd>
                    <hlm-switch
                      [attr.aria-label]="'Toggle ' + k.label"
                      [checked]="!k.disabled"
                      (checkedChange)="toggleEnabled(k, $event)"
                    />
                  </td>
                  <td
                    hlmTd
                    class="text-right"
                  >
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      align="end"
                      [hlmDropdownMenuTrigger]="rowMenu"
                      [attr.aria-label]="'Actions for ' + k.label"
                    >
                      <ng-icon
                        name="lucideEllipsisVertical"
                        class="text-base"
                      />
                    </button>
                    <ng-template #rowMenu>
                      <hlm-dropdown-menu class="w-40">
                        <button
                          hlmDropdownMenuItem
                          class="text-destructive"
                          (click)="onDelete(k)"
                        >
                          <ng-icon name="lucideTrash2" />
                          {{ 'keys.delete' | translate }}
                        </button>
                      </hlm-dropdown-menu>
                    </ng-template>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <ob-key-create-dialog (created)="onCreated($event)" />
    <ob-key-secret-once-dialog />
    <ob-confirm-dialog
      [title]="'keys.deleteTitle' | translate"
      [description]="deleteDescription()"
      [confirmLabel]="'keys.delete' | translate"
      [destructive]="true"
    />
  `,
})
export class KeysListComponent implements OnInit, OnDestroy {
  protected readonly store = inject(KeysSignalStore);
  private readonly pageHeader = inject(PageHeaderService);

  protected readonly createDialog = viewChild.required(KeyCreateDialogComponent);
  protected readonly secretDialog = viewChild.required(KeySecretOnceDialogComponent);
  protected readonly confirmDialog = viewChild.required(ConfirmDialogComponent);

  protected readonly skeletonRows = [0, 1, 2];
  protected readonly deleteTarget = signal<KeySummaryDto | null>(null);
  protected readonly deleteDescription = computed(
    () =>
      `Permanently delete the key "${this.deleteTarget()?.label ?? ''}"? Applications using it will stop working.`,
  );

  constructor() {
    this.pageHeader.setPageHeader('keys.title', 'keys.subtitle');
    this.pageHeader.setActionButton('keys.create', () => this.createDialog().open());
  }

  ngOnInit(): void {
    void this.store.refresh();
  }

  ngOnDestroy(): void {
    this.pageHeader.hideActionButton();
  }

  onCreated(key: CreatedKeyDto): void {
    this.secretDialog().open(key);
  }

  async toggleEnabled(k: KeySummaryDto, enabled: boolean): Promise<void> {
    try {
      await this.store.update(k.id, { disabled: !enabled });
      notify.success(enabled ? 'Access key enabled' : 'Access key disabled');
    } catch {
      notify.error('Failed to update key');
    }
  }

  async onDelete(k: KeySummaryDto): Promise<void> {
    this.deleteTarget.set(k);
    const ok = await this.confirmDialog().confirm();
    if (!ok) return;
    try {
      await this.store.remove(k.id);
      notify.success('Access key deleted');
    } catch {
      notify.error('Failed to delete key');
    }
  }
}
