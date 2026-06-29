import { ChangeDetectionStrategy, Component, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { CreatedKeyDto } from '@openbucket/api-client';

import { KeysSignalStore } from './keys.signal-store';
import { notify } from '../shared/ui/notify';

/**
 * Create-access-key dialog (STORY-0611 / TASK-1855) on HlmDialog. On success it
 * emits the created key (incl. the one-time secret) for the secret-once dialog.
 */
@Component({
  selector: 'ob-key-create-dialog',
  standalone: true,
  imports: [FormsModule, BrnDialogImports, HlmDialogImports, HlmButton, HlmInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-md"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>Create access key</h3>
          <p hlmDialogDescription>Give the key a label to identify it later.</p>
        </hlm-dialog-header>

        <div class="space-y-3 py-2">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">Label</span>
            <input
              hlmInput
              class="w-full"
              autocomplete="off"
              placeholder="e.g. ci-pipeline"
              [ngModel]="label()"
              (ngModelChange)="label.set($event)"
              (keyup.enter)="submit()"
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
            [disabled]="creating()"
          >
            Cancel
          </button>
          <button
            hlmBtn
            (click)="submit()"
            [disabled]="creating() || !label().trim()"
          >
            {{ creating() ? 'Creating…' : 'Create' }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class KeyCreateDialogComponent {
  private readonly store = inject(KeysSignalStore);
  readonly created = output<CreatedKeyDto>();

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly label = signal('');
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);

  open(): void {
    this.label.set('');
    this.error.set(null);
    this.creating.set(false);
    this.dialog().open();
  }

  protected close(): void {
    if (!this.creating()) this.dialog().close();
  }

  protected async submit(): Promise<void> {
    const label = this.label().trim();
    if (!label || this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    try {
      const key = await this.store.create({ label });
      notify.success('Access key created');
      this.created.emit(key);
      this.dialog().close();
    } catch {
      this.error.set('Failed to create access key — please try again.');
    } finally {
      this.creating.set(false);
    }
  }
}
