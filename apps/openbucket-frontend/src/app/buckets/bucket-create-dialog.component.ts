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
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';
import { CreateBucketDtoVersioningEnum } from '@openbucket/api-client';

import { BucketsSignalStore } from './buckets.signal-store';
import { notify } from '../shared/ui/notify';

/** S3 bucket name: 3–63 chars, lowercase alphanumerics, dots and hyphens. */
const S3_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Create-bucket dialog (STORY-0603 / TASK-1815) on the spartan HlmDialog —
 * focus-trap/restore/Escape come from BrnDialog/CDK. Self-contained: validates
 * the name, calls the store, toasts, and emits `created` on success.
 */
@Component({
  selector: 'ob-bucket-create-dialog',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    HlmDialogImports,
    BrnDialogImports,
    HlmButton,
    HlmInput,
    HlmSwitch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog (closed)="onClosed()">
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-md"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ 'buckets.createTitle' | translate }}</h3>
          <p hlmDialogDescription>{{ 'buckets.createHint' | translate }}</p>
        </hlm-dialog-header>

        <div class="space-y-4 py-2">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ 'buckets.name' | translate }}</span>
            <input
              hlmInput
              class="w-full"
              autocomplete="off"
              placeholder="my-bucket"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              (keyup.enter)="submit()"
            />
            <span class="text-xs text-muted-foreground">
              {{ 'buckets.nameRules' | translate }}
            </span>
          </label>

          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium">{{ 'buckets.enableVersioning' | translate }}</span>
            <hlm-switch
              [attr.aria-label]="'buckets.enableVersioning' | translate"
              [checked]="versioning()"
              (checkedChange)="versioning.set($event)"
            />
          </div>

          @if (error()) {
            <p class="text-sm font-medium text-destructive">{{ error() }}</p>
          }
        </div>

        <hlm-dialog-footer>
          <button
            hlmBtn
            variant="outline"
            (click)="close()"
            [disabled]="creating()"
          >
            {{ 'buckets.cancel' | translate }}
          </button>
          <button
            hlmBtn
            (click)="submit()"
            [disabled]="creating() || !nameValid()"
          >
            {{ creating() ? ('buckets.creating' | translate) : ('buckets.createButton' | translate) }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class BucketCreateDialogComponent {
  private readonly store = inject(BucketsSignalStore);
  readonly created = output<void>();

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly name = signal('');
  protected readonly versioning = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly creating = signal(false);

  protected readonly nameValid = computed(() => S3_NAME.test(this.name().trim()));

  open(): void {
    this.name.set('');
    this.versioning.set(false);
    this.error.set(null);
    this.creating.set(false);
    this.dialog().open();
  }

  protected close(): void {
    if (!this.creating()) this.dialog().close();
  }

  protected onClosed(): void {
    this.creating.set(false);
  }

  protected async submit(): Promise<void> {
    if (!this.nameValid() || this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    try {
      await this.store.create({
        name: this.name().trim(),
        versioning: this.versioning()
          ? CreateBucketDtoVersioningEnum.Enabled
          : CreateBucketDtoVersioningEnum.Disabled,
      });
      notify.success('Bucket created');
      this.created.emit();
      this.dialog().close();
    } catch (e) {
      this.error.set(this.messageFor(e));
    } finally {
      this.creating.set(false);
    }
  }

  private messageFor(e: unknown): string {
    const status = (e as { status?: number }).status;
    if (status === 409) return 'A bucket with that name already exists.';
    if (status === 400 || status === 422) return 'Invalid bucket name (3–63 chars, S3 naming rules).';
    if (status === 0) return 'Cannot reach the server.';
    return 'Failed to create bucket — please try again.';
  }
}
