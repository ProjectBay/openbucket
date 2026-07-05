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
import { lucideEllipsisVertical, lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';
import { AdminUserSummaryDto } from '@openbucket/api-client';

import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';
import { ListStateComponent } from '../shared/ui/list-state.component';
import { SortHeaderComponent, type SortDir } from '../shared/ui/sort-header.component';
import { notify } from '../shared/ui/notify';
import { AuthService } from '../auth/auth.service';
import { AdminUsersSignalStore } from './admin-users.signal-store';
import { AdminUserCreateDialogComponent } from './admin-user-create-dialog.component';
import { AdminUserEditDialogComponent } from './admin-user-edit-dialog.component';

/**
 * Multi-admin users management (EPIC-11, STORY-1002). This screen is full-admin
 * only (guarded by `fullAdminGuard` on the route), so every control is shown.
 * List / create / edit-role / reset-password / delete over spartan-ng, mirroring
 * the keys list. The current admin cannot delete themselves (server 403s; the row
 * action is also hidden). Title + Create action via the unified page header.
 */
@Component({
  selector: 'ob-admin-users-list',
  standalone: true,
  imports: [
    TranslateModule,
    NgIcon,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    HlmDropdownMenuImports,
    RelativeTimePipe,
    ConfirmDialogComponent,
    ListStateComponent,
    SortHeaderComponent,
    AdminUserCreateDialogComponent,
    AdminUserEditDialogComponent,
  ],
  providers: [provideIcons({ lucideEllipsisVertical, lucidePencil, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6">
      <div class="mb-4 flex justify-end">
        <button
          hlmBtn
          (click)="createDialog().open()"
        >
          {{ 'users.create' | translate }}
        </button>
      </div>
      <ob-list-state
        [loading]="store.loading()"
        [error]="store.error()"
        [empty]="store.count() === 0"
        emptyTitle="users.empty"
        emptyHint="users.emptyHint"
        [skeletonCount]="3"
      >
        <button
          listEmptyAction
          hlmBtn
          (click)="createDialog().open()"
        >
          {{ 'users.create' | translate }}
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
                    label="users.username"
                    [active]="sortKey() === 'username'"
                    [dir]="sortDir()"
                    (sortToggle)="toggleSort('username')"
                  />
                </th>
                <th hlmTh>{{ 'users.role' | translate }}</th>
                <th hlmTh>{{ 'users.status' | translate }}</th>
                <th hlmTh>{{ 'users.created' | translate }}</th>
                <th
                  hlmTh
                  class="w-12 text-right"
                >
                  {{ 'users.actions' | translate }}
                </th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (u of sorted(); track u.username) {
                <tr hlmTr>
                  <td
                    hlmTd
                    class="font-medium"
                  >
                    {{ u.username }}
                    @if (u.username === currentUser()) {
                      <span class="text-muted-foreground ml-1 text-xs">{{ 'users.you' | translate }}</span>
                    }
                  </td>
                  <td hlmTd>
                    <span
                      hlmBadge
                      [variant]="u.role === 'admin' ? 'default' : 'secondary'"
                      >{{ (u.role === 'admin' ? 'users.roleAdmin' : 'users.roleReadonly') | translate }}</span
                    >
                  </td>
                  <td hlmTd>
                    @if (u.mustChangePassword) {
                      <span class="text-muted-foreground text-xs">{{
                        'users.mustChangePassword' | translate
                      }}</span>
                    } @else {
                      <span class="text-muted-foreground text-xs">{{ 'users.active' | translate }}</span>
                    }
                  </td>
                  <td hlmTd>{{ u.createdAt | relativeTime }}</td>
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
                      [attr.aria-label]="'Actions for ' + u.username"
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
                          (click)="onEdit(u)"
                        >
                          <ng-icon name="lucidePencil" />
                          {{ 'users.edit' | translate }}
                        </button>
                        @if (u.username !== currentUser()) {
                          <button
                            hlmDropdownMenuItem
                            class="text-destructive"
                            (click)="onDelete(u)"
                          >
                            <ng-icon name="lucideTrash2" />
                            {{ 'users.delete' | translate }}
                          </button>
                        }
                      </hlm-dropdown-menu>
                    </ng-template>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ob-list-state>
    </div>

    <ob-admin-user-create-dialog (created)="store.refresh()" />
    <ob-admin-user-edit-dialog (saved)="store.refresh()" />
    <ob-confirm-dialog
      [title]="confirmConfig().title"
      [description]="confirmConfig().description"
      [confirmLabel]="confirmConfig().confirmLabel"
      [destructive]="true"
    />
  `,
})
export class AdminUsersListComponent implements OnInit {
  protected readonly store = inject(AdminUsersSignalStore);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(TranslateService);

  protected readonly createDialog = viewChild.required(AdminUserCreateDialogComponent);
  protected readonly editDialog = viewChild.required(AdminUserEditDialogComponent);
  protected readonly confirmDialog = viewChild.required(ConfirmDialogComponent);

  protected readonly currentUser = this.auth.username;
  protected readonly sortKey = signal<'username'>('username');
  protected readonly sortDir = signal<SortDir>('asc');
  protected readonly confirmConfig = signal<{ title: string; description: string; confirmLabel: string }>({
    title: '',
    description: '',
    confirmLabel: '',
  });

  protected readonly sorted = computed(() => {
    const factor = this.sortDir() === 'asc' ? 1 : -1;
    return [...this.store.items()].sort(
      (a, b) => a.username.localeCompare(b.username) * factor,
    );
  });

  ngOnInit(): void {
    void this.store.refresh();
  }

  protected toggleSort(key: 'username'): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  protected onEdit(u: AdminUserSummaryDto): void {
    this.editDialog().open(u);
  }

  protected async onDelete(u: AdminUserSummaryDto): Promise<void> {
    this.confirmConfig.set({
      title: this.i18n.instant('users.deleteTitle'),
      description: this.i18n.instant('users.deleteHint', { username: u.username }),
      confirmLabel: this.i18n.instant('users.delete'),
    });
    const ok = await this.confirmDialog().confirm();
    if (!ok) return;
    try {
      await this.store.remove(u.username);
      notify.success('Admin user deleted');
    } catch {
      notify.error('Failed to delete admin user');
    }
  }
}
