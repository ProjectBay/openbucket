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
import { AdminUserSummaryDto, UpdateAdminUserDtoRoleEnum } from '@openbucket/api-client';

import { AdminUsersSignalStore } from './admin-users.signal-store';
import { notify } from '../shared/ui/notify';

const MIN_PASSWORD = 12;

/**
 * Edit-admin-user dialog (EPIC-11, STORY-1002): reassign the role and/or reset
 * the password (optional field, blank ⇒ unchanged). A reset kills the target's
 * live sessions server-side and forces a rotation on their next login. Only sends
 * fields that actually changed; a no-op is disabled at the button.
 */
@Component({
  selector: 'ob-admin-user-edit-dialog',
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
          <h3 hlmDialogTitle>{{ 'users.editTitle' | translate }}</h3>
          <p hlmDialogDescription>{{ target()?.username }}</p>
        </hlm-dialog-header>

        <div class="space-y-3 py-2">
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

          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ 'users.resetPassword' | translate }}</span>
            <input
              hlmInput
              type="password"
              class="w-full"
              autocomplete="new-password"
              [placeholder]="'users.resetPasswordHint' | translate"
              [ngModel]="newPassword()"
              (ngModelChange)="newPassword.set($event)"
            />
          </label>

          @if (error()) {
            <p class="text-destructive text-sm font-medium">{{ error() }}</p>
          }
        </div>

        <hlm-dialog-footer>
          <button
            hlmBtn
            variant="outline"
            (click)="close()"
            [disabled]="saving()"
          >
            {{ 'users.cancel' | translate }}
          </button>
          <button
            hlmBtn
            (click)="submit()"
            [disabled]="saving() || !canSubmit()"
          >
            {{ (saving() ? 'users.saving' : 'users.save') | translate }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class AdminUserEditDialogComponent {
  private readonly store = inject(AdminUsersSignalStore);
  readonly saved = output<void>();

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly roles = UpdateAdminUserDtoRoleEnum;

  protected readonly target = signal<AdminUserSummaryDto | null>(null);
  protected readonly role = signal<UpdateAdminUserDtoRoleEnum>(UpdateAdminUserDtoRoleEnum.Readonly);
  protected readonly newPassword = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canSubmit = computed(() => {
    const t = this.target();
    if (!t) return false;
    const roleChanged = this.role() !== (t.role as unknown as UpdateAdminUserDtoRoleEnum);
    const pw = this.newPassword();
    const pwValid = pw.length === 0 || pw.length >= MIN_PASSWORD;
    // Must change something, and any provided password must meet the floor.
    return pwValid && (roleChanged || pw.length >= MIN_PASSWORD);
  });

  open(user: AdminUserSummaryDto): void {
    this.target.set(user);
    this.role.set(user.role as unknown as UpdateAdminUserDtoRoleEnum);
    this.newPassword.set('');
    this.error.set(null);
    this.saving.set(false);
    this.dialog().open();
  }

  protected close(): void {
    if (!this.saving()) this.dialog().close();
  }

  protected async submit(): Promise<void> {
    const t = this.target();
    if (!t || !this.canSubmit() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const roleChanged = this.role() !== (t.role as unknown as UpdateAdminUserDtoRoleEnum);
    const pw = this.newPassword();
    try {
      await this.store.update(t.username, {
        ...(roleChanged ? { role: this.role() } : {}),
        ...(pw.length >= MIN_PASSWORD ? { newPassword: pw } : {}),
      });
      notify.success('Admin user updated');
      this.saved.emit();
      this.dialog().close();
    } catch {
      this.error.set('Failed to update admin user — please try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
