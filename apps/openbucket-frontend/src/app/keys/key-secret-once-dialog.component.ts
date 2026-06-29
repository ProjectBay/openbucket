import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmAlertImports } from '@openbucket/spartan-ui/alert';
import { CreatedKeyDto } from '@openbucket/api-client';

import { CopyButtonComponent } from '../shared/ui/copy-button.component';

/**
 * Shows a newly-created access key's secret exactly once (STORY-0611 / TASK-1856).
 * The secret is never persisted in the store — copy it here or lose it.
 */
@Component({
  selector: 'ob-key-secret-once-dialog',
  standalone: true,
  imports: [BrnDialogImports, HlmDialogImports, HlmButton, HlmAlertImports, CopyButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-lg"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>Access key created</h3>
          <p hlmDialogDescription>Copy the secret now — it won't be shown again.</p>
        </hlm-dialog-header>

        @if (created(); as k) {
          <div class="space-y-3 py-2 text-sm">
            <div class="space-y-1">
              <span class="text-muted-foreground text-xs">Access Key ID</span>
              <div class="flex items-center gap-2">
                <code class="bg-muted flex-1 truncate rounded px-2 py-1 font-mono text-xs">{{ k.accessKeyId }}</code>
                <ob-copy-button
                  [value]="k.accessKeyId"
                  label="Copy access key ID"
                />
              </div>
            </div>
            <div class="space-y-1">
              <span class="text-muted-foreground text-xs">Secret Access Key</span>
              <div class="flex items-center gap-2">
                <code class="bg-muted flex-1 truncate rounded px-2 py-1 font-mono text-xs">{{ k.secretAccessKey }}</code>
                <ob-copy-button
                  [value]="k.secretAccessKey"
                  label="Copy secret access key"
                />
              </div>
            </div>
            <div
              hlmAlert
              variant="destructive"
            >
              <p hlmAlertDescription>This secret won't be shown again. Store it somewhere safe.</p>
            </div>
          </div>
        }

        <hlm-dialog-footer>
          <button
            hlmBtn
            (click)="close()"
          >
            Done
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class KeySecretOnceDialogComponent {
  protected readonly created = signal<CreatedKeyDto | null>(null);
  private readonly dialog = viewChild.required(HlmDialog);

  open(key: CreatedKeyDto): void {
    this.created.set(key);
    this.dialog().open();
  }

  protected close(): void {
    this.dialog().close();
    this.created.set(null);
  }
}
