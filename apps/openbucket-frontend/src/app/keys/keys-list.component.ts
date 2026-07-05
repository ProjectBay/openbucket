import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBan,
  lucideEllipsisVertical,
  lucideRotateCw,
  lucideShieldCheck,
  lucideTrash2,
} from '@ng-icons/lucide';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';
import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';
import { CreatedKeyDto, KeySummaryDto } from '@openbucket/api-client';

import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { CopyButtonComponent } from '../shared/ui/copy-button.component';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { SortHeaderComponent, type SortDir } from '../shared/ui/sort-header.component';
import { notify } from '../shared/ui/notify';
import { AuthService } from '../auth/auth.service';
import { KeysSignalStore } from './keys.signal-store';
import { KeyCreateDialogComponent } from './key-create-dialog.component';
import { KeySecretOnceDialogComponent } from './key-secret-once-dialog.component';
import { KeyEffectivePermissionsComponent } from './key-effective-permissions.component';

type KeySortKey = 'label' | 'lastUsed';

interface ConfirmConfig {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

/**
 * Access-keys management (STORY-0611 / EPIC-11): list/create/enable-disable/
 * delete on spartan-ng, plus scope minting, Rotate (one-time secret reveal),
 * Revoke (reversible disable) and an effective-permissions panel. Sortable
 * headers, shared list-state, one-time secret reveal. Title + Create action via
 * the unified page header.
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
    HlmDropdownMenuImports,
    RelativeTimePipe,
    CopyButtonComponent,
    ConfirmDialogComponent,
    ListStateComponent,
    SortHeaderComponent,
    KeyCreateDialogComponent,
    KeySecretOnceDialogComponent,
    KeyEffectivePermissionsComponent,
  ],
  providers: [
    provideIcons({
      lucideEllipsisVertical,
      lucideTrash2,
      lucideRotateCw,
      lucideBan,
      lucideShieldCheck,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6">
      <!-- EPIC-11: no create action for read-only admins (UX; server is authoritative). -->
      @if (!auth.isReadOnly()) {
        <div class="mb-4 flex justify-end">
          <button
            hlmBtn
            (click)="createDialog().open()"
          >
            {{ 'keys.create' | translate }}
          </button>
        </div>
      }
      <ob-list-state
        [loading]="store.loading()"
        [error]="store.error()"
        [empty]="store.count() === 0"
        emptyTitle="keys.empty"
        emptyHint="keys.emptyHint"
        [skeletonCount]="3"
      >
        <button
          listEmptyAction
          hlmBtn
          (click)="createDialog().open()"
        >
          {{ 'keys.create' | translate }}
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
                    label="keys.label"
                    [active]="sortKey() === 'label'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('label')"
                  />
                </th>
                <th hlmTh>{{ 'keys.accessKeyId' | translate }}</th>
                <th hlmTh>{{ 'keys.role' | translate }}</th>
                <th hlmTh>{{ 'keys.scope' | translate }}</th>
                <th hlmTh>
                  <ob-sort-header
                    label="keys.lastUsed"
                    [active]="sortKey() === 'lastUsed'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('lastUsed')"
                  />
                </th>
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
              @for (k of sorted(); track k.id) {
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
                    @if (k.scope; as s) {
                      <div class="flex items-center gap-1">
                        <span
                          hlmBadge
                          variant="secondary"
                          >{{ 'keys.scoped' | translate }}</span
                        >
                        @if (s.bucket) {
                          <code class="text-muted-foreground font-mono text-xs">
                            {{ s.bucket }}/{{ s.prefix ?? '' }}
                          </code>
                        }
                      </div>
                    } @else {
                      <span class="text-muted-foreground text-xs">{{
                        'keys.root' | translate
                      }}</span>
                    }
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
                      [disabled]="auth.isReadOnly()"
                      (checkedChange)="toggleEnabled(k, $event)"
                    />
                  </td>
                  <td
                    hlmTd
                    class="text-right"
                  >
                    <!-- EPIC-11: mutating actions hidden for read-only admins. -->
                    @if (!auth.isReadOnly()) {
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
                      <hlm-dropdown-menu class="w-44">
                        <button
                          hlmDropdownMenuItem
                          (click)="onPermissions(k)"
                        >
                          <ng-icon name="lucideShieldCheck" />
                          {{ 'keys.permissions' | translate }}
                        </button>
                        <button
                          hlmDropdownMenuItem
                          (click)="onRotate(k)"
                        >
                          <ng-icon name="lucideRotateCw" />
                          {{ 'keys.rotate' | translate }}
                        </button>
                        <button
                          hlmDropdownMenuItem
                          (click)="onRevoke(k)"
                        >
                          <ng-icon name="lucideBan" />
                          {{ 'keys.revoke' | translate }}
                        </button>
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
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ob-list-state>
    </div>

    <ob-key-create-dialog (created)="onCreated($event)" />
    <ob-key-secret-once-dialog />
    <ob-key-effective-permissions />
    <ob-confirm-dialog
      [title]="confirmConfig().title"
      [description]="confirmConfig().description"
      [confirmLabel]="confirmConfig().confirmLabel"
      [destructive]="confirmConfig().destructive"
    />
  `,
})
export class KeysListComponent implements OnInit {
  protected readonly store = inject(KeysSignalStore);
  protected readonly auth = inject(AuthService);
  private readonly i18n = inject(TranslateService);

  protected readonly createDialog = viewChild.required(KeyCreateDialogComponent);
  protected readonly secretDialog = viewChild.required(KeySecretOnceDialogComponent);
  protected readonly confirmDialog = viewChild.required(ConfirmDialogComponent);
  protected readonly permissionsPanel = viewChild.required(KeyEffectivePermissionsComponent);

  protected readonly sortKey = signal<KeySortKey>('label');
  protected readonly sortDir = signal<SortDir>('asc');
  protected readonly confirmConfig = signal<ConfirmConfig>({
    title: '',
    description: '',
    confirmLabel: '',
    destructive: false,
  });

  protected readonly sorted = computed(() => {
    const key = this.sortKey();
    const factor = this.sortDir() === 'asc' ? 1 : -1;
    return [...this.store.items()].sort((a, b) => {
      let cmp = 0;
      if (key === 'label') {
        cmp = (a.label ?? '').localeCompare(b.label ?? '');
      } else {
        // lastUsed: nulls (never used) sort last in ascending order.
        const at = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : -Infinity;
        const bt = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : -Infinity;
        cmp = at - bt;
      }
      return cmp * factor;
    });
  });

  ngOnInit(): void {
    void this.store.refresh();
  }

  protected toggleSort(key: KeySortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
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

  protected onPermissions(k: KeySummaryDto): void {
    void this.permissionsPanel().open(k);
  }

  async onRotate(k: KeySummaryDto): Promise<void> {
    const ok = await this.ask({
      title: this.i18n.instant('keys.rotateTitle'),
      description: this.i18n.instant('keys.rotateHint', { label: k.label }),
      confirmLabel: this.i18n.instant('keys.rotate'),
      destructive: false,
    });
    if (!ok) return;
    try {
      const rotated = await this.store.rotate(k.id);
      // RotatedKeyDto mirrors CreatedKeyDto — reuse the one-time secret reveal.
      this.secretDialog().open(rotated);
      notify.success('Access key rotated');
    } catch {
      notify.error('Failed to rotate key');
    }
  }

  async onRevoke(k: KeySummaryDto): Promise<void> {
    const ok = await this.ask({
      title: this.i18n.instant('keys.revokeTitle'),
      description: this.i18n.instant('keys.revokeHint', { label: k.label }),
      confirmLabel: this.i18n.instant('keys.revoke'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.store.revoke(k.id);
      notify.success('Access key revoked');
    } catch {
      notify.error('Failed to revoke key');
    }
  }

  async onDelete(k: KeySummaryDto): Promise<void> {
    const ok = await this.ask({
      title: this.i18n.instant('keys.deleteTitle'),
      description: this.i18n.instant('keys.deleteHint', { label: k.label }),
      confirmLabel: this.i18n.instant('keys.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.store.remove(k.id);
      notify.success('Access key deleted');
    } catch {
      notify.error('Failed to delete key');
    }
  }

  private ask(config: ConfirmConfig): Promise<boolean> {
    this.confirmConfig.set(config);
    return this.confirmDialog().confirm();
  }
}
