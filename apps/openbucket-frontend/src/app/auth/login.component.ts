import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmAlertImports } from '@openbucket/spartan-ui/alert';

import { AuthService } from './auth.service';
import { BrandComponent } from '../layout/shell/components/brand.component';
import { StatusAnnouncer } from '../shared/ui/status-announcer.service';

/**
 * Admin login (§5.11/§5.12), rebuilt on the design system (STORY-0608). Submits
 * to AuthService.login, which stores the in-memory access token, loads /me, and
 * navigates to /buckets (or /force-rotate). Errors surface in an hlm-alert that is
 * also announced to screen readers.
 */
@Component({
  selector: 'ob-login',
  standalone: true,
  imports: [FormsModule, TranslateModule, HlmCardImports, HlmButton, HlmInput, HlmAlertImports, BrandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="bg-muted/30 flex min-h-screen items-center justify-center p-6">
      <div
        hlmCard
        class="w-full max-w-sm"
      >
        <div
          hlmCardHeader
          class="items-center text-center"
        >
          <div class="flex justify-center">
            <ob-brand subtitle="" />
          </div>
          <p hlmCardDescription>{{ 'auth.signInSubtitle' | translate }}</p>
        </div>
        <div hlmCardContent>
          <form
            class="space-y-4"
            (ngSubmit)="onSubmit()"
          >
            <label class="block space-y-1.5">
              <span class="text-sm font-medium">{{ 'auth.username' | translate }}</span>
              <input
                hlmInput
                name="username"
                class="w-full"
                autocomplete="username"
                required
                [(ngModel)]="username"
                [attr.aria-invalid]="error() ? 'true' : null"
                aria-describedby="login-error"
              />
            </label>

            <label class="block space-y-1.5">
              <span class="text-sm font-medium">{{ 'auth.password' | translate }}</span>
              <input
                hlmInput
                name="password"
                type="password"
                class="w-full"
                autocomplete="current-password"
                required
                [(ngModel)]="password"
                [attr.aria-invalid]="error() ? 'true' : null"
                aria-describedby="login-error"
              />
            </label>

            @if (error()) {
              <div
                hlmAlert
                variant="destructive"
                role="alert"
                id="login-error"
              >
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }

            <button
              hlmBtn
              type="submit"
              class="w-full"
              [disabled]="busy()"
            >
              {{ busy() ? ('auth.signingIn' | translate) : ('auth.signIn' | translate) }}
            </button>
          </form>
        </div>
      </div>
    </main>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly announcer = inject(StatusAnnouncer);

  username = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async onSubmit(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.auth.login(this.username.trim(), this.password);
    } catch (e) {
      const msg = this.messageFor(e);
      this.error.set(msg);
      this.announcer.announce(msg, 'assertive');
    } finally {
      this.busy.set(false);
    }
  }

  private messageFor(e: unknown): string {
    const status = (e as { status?: number }).status;
    if (status === 400 || status === 401) return 'Invalid username or password.';
    if (status === 0) return 'Cannot reach the server.';
    return 'Sign-in failed — please try again.';
  }
}
