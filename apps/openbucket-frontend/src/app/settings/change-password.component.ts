import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { SettingsAdminService } from '@openbucket/api-client';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';

import { notify } from '../shared/ui/notify';

/**
 * Change-password form (STORY-0607 / TASK-1839) on the design system, over
 * `SettingsAdminService.changePassword`. Reused by the force-rotate screen
 * (STORY-0608).
 */
@Component({
  selector: 'ob-change-password',
  standalone: true,
  imports: [FormsModule, TranslateModule, HlmCardImports, HlmButton, HlmInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmCard>
      <div hlmCardHeader>
        <h3 hlmCardTitle>{{ 'settings.changePassword' | translate }}</h3>
        <p hlmCardDescription>{{ 'settings.changePasswordHint' | translate }}</p>
      </div>
      <div
        hlmCardContent
        class="space-y-3"
      >
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ 'settings.currentPassword' | translate }}</span>
          <input
            hlmInput
            type="password"
            class="w-full"
            autocomplete="current-password"
            [ngModel]="current()"
            (ngModelChange)="current.set($event)"
          />
        </label>
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ 'settings.newPassword' | translate }}</span>
          <input
            hlmInput
            type="password"
            class="w-full"
            autocomplete="new-password"
            [ngModel]="next()"
            (ngModelChange)="next.set($event)"
          />
        </label>
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">{{ 'settings.confirmPassword' | translate }}</span>
          <input
            hlmInput
            type="password"
            class="w-full"
            autocomplete="new-password"
            [ngModel]="confirm()"
            (ngModelChange)="confirm.set($event)"
            (keyup.enter)="submit()"
          />
        </label>

        @if (next().length > 0 && next().length < 8) {
          <p class="text-muted-foreground text-xs">Password must be at least 8 characters.</p>
        } @else if (confirm().length > 0 && next() !== confirm()) {
          <p class="text-destructive text-xs">Passwords don't match.</p>
        }
        @if (error()) {
          <p class="text-destructive text-sm font-medium">{{ error() }}</p>
        }

        <button
          hlmBtn
          (click)="submit()"
          [disabled]="busy() || !valid()"
        >
          {{ busy() ? ('settings.changing' | translate) : ('settings.changeButton' | translate) }}
        </button>
      </div>
    </div>
  `,
})
export class ChangePasswordComponent {
  private readonly settings = inject(SettingsAdminService);

  /** Emitted after a successful password change (force-rotate uses it to continue). */
  readonly changed = output<void>();

  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly valid = computed(
    () => this.current().length > 0 && this.next().length >= 8 && this.next() === this.confirm(),
  );

  async submit(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.settings.changePassword({
          currentPassword: this.current(),
          newPassword: this.next(),
        }),
      );
      notify.success('Password changed');
      this.current.set('');
      this.next.set('');
      this.confirm.set('');
      this.changed.emit();
    } catch (e) {
      this.error.set(this.messageFor(e));
    } finally {
      this.busy.set(false);
    }
  }

  private messageFor(e: unknown): string {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return 'Current password is incorrect.';
    if (status === 400 || status === 422) return 'New password does not meet requirements.';
    if (status === 0) return 'Cannot reach the server.';
    return 'Failed to change password — please try again.';
  }
}
