import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from './auth.service';
import { BrandComponent } from '../layout/shell/components/brand.component';
import { ChangePasswordComponent } from '../settings/change-password.component';

/**
 * Forced password rotation (STORY-0608 / TASK-1843). `AuthService.login` routes
 * must-change-password users here. Reuses the shared change-password form; on
 * success, refresh /me and continue into the app.
 */
@Component({
  selector: 'ob-force-rotate',
  standalone: true,
  imports: [TranslateModule, BrandComponent, ChangePasswordComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="bg-muted/30 flex min-h-screen items-center justify-center p-6">
      <div class="w-full max-w-sm space-y-5">
        <div class="flex flex-col items-center gap-2 text-center">
          <div class="flex justify-center">
            <ob-brand subtitle="" />
          </div>
          <p class="text-muted-foreground text-sm">{{ 'auth.forceRotateHint' | translate }}</p>
        </div>
        <ob-change-password (changed)="onChanged()" />
      </div>
    </main>
  `,
})
export class ForceRotateComponent {
  private readonly auth = inject(AuthService);

  onChanged(): void {
    void this.auth.finishRotation();
  }
}
