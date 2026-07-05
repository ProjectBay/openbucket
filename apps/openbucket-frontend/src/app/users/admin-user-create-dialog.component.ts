import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { AdminUserSummaryDto, CreateAdminUserDtoRoleEnum } from '@openbucket/api-client';

import { AdminUsersSignalStore } from './admin-users.signal-store';
import { notify } from '../shared/ui/notify';

/** Client-side mirror of the TASK-3022 zod floors (server is the source of truth). */
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;
const MIN_PASSWORD = 12;
const MIN_USERNAME = 3;

/**
 * Create-admin-user dialog (EPIC-11, STORY-1002). Username / password / role.
 * Surfaces the same 3–64 username regex and 12-char password floor the server
 * enforces as client validation. The created admin is forced to rotate its
 * password on first login (server sets mustChangePassword).
 */
@Component({
  selector: 'ob-admin-user-create-dialog',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    BrnDialogImports,
    BrnSelectImports,
    HlmDialogImports,
    HlmSelectImports,
    HlmButton,
    HlmInput,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-md"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ 'users.createTitle' | translate }}</h3>
          <p hlmDialogDescription>{{ 'users.createHint' | translate }}</p>
        </hlm-dialog-header>

        <div class="space-y-3 py-2">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ 'users.username' | translate }}</span>
            <input
              hlmInput
              class="w-full"
              autocomplete="off"
              placeholder="e.g. jane.doe"
              [ngModel]="username()"
              (ngModelChange)="username.set($event)"
            />
          </label>

          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ 'users.password' | translate }}</span>
            <input
              hlmInput
              type="password"
              class="w-full"
              autocomplete="new-password"
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
            />
            <span class="text-muted-foreground text-xs">{{ 'users.passwordHint' | translate }}</span>
          </label>

          <div class="space-y-1.5">
            <span class="text-sm font-medium">{{ 'users.role' | translate }}</span>
            <brn-select
              hlm
              [ngModel]="role()"
              (ngModelChange)="role.set($event)"
            >
              <hlm-select-trigger class="w-full">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content>
                <hlm-option [value]="roles.Admin">{{ 'users.roleAdmin' | translate }}</hlm-option>
                <hlm-option [value]="roles.Readonly">{{ 'users.roleReadonly' | translate }}</hlm-option>
              </hlm-select-content>
            </brn-select>
          </div>

          @if (error()) {
            <p class="text-destructive text-sm font-medium">{{ error() }}</p>
          }
        </div>

        <hlm-dialog-footer>
          <button
            hlmBtn
            variant="outline"
            (click)="close()"
            [disabled]="creating()"
          >
            {{ 'users.cancel' | translate }}
          </button>
          <button
            hlmBtn
            (click)="submit()"
            [disabled]="creating() || !canSubmit()"
          >
            {{ (creating() ? 'users.creating' : 'users.create') | translate }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class AdminUserCreateDialogComponent {
  private readonly store = inject(AdminUsersSignalStore);
  readonly created = output<AdminUserSummaryDto>();

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly roles = CreateAdminUserDtoRoleEnum;

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly role = signal<CreateAdminUserDtoRoleEnum>(CreateAdminUserDtoRoleEnum.Readonly);
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canSubmit = computed(() => {
    const u = this.username().trim();
    if (u.length < MIN_USERNAME || !USERNAME_RE.test(u)) return false;
    if (this.password().length < MIN_PASSWORD) return false;
    return true;
  });

  open(): void {
    this.username.set('');
    this.password.set('');
    this.role.set(CreateAdminUserDtoRoleEnum.Readonly);
    this.error.set(null);
    this.creating.set(false);
    this.dialog().open();
  }

  protected close(): void {
    if (!this.creating()) this.dialog().close();
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit() || this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    try {
      const created = await this.store.create({
        username: this.username().trim(),
        password: this.password(),
        role: this.role(),
      });
      notify.success('Admin user created');
      this.created.emit(created);
      this.dialog().close();
    } catch {
      this.error.set('Failed to create admin user — please try again.');
    } finally {
      this.creating.set(false);
    }
  }
}
