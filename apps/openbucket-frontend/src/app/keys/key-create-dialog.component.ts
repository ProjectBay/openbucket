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
import {
  CreatedKeyDto,
  CreateKeyDtoScope,
  CreateKeyDtoScopeOneOfKindEnum,
} from '@openbucket/api-client';

import { KeysSignalStore } from './keys.signal-store';
import { notify } from '../shared/ui/notify';

/** The object-scope actions offered by the scope builder (closed set). */
const SCOPE_ACTIONS = ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'] as const;

/**
 * Create-access-key dialog (STORY-0611 / EPIC-11 TASK-3013) on HlmDialog. An
 * optional scope section (toggled by a switch) restricts the minted sub-key to a
 * bucket / prefix / action set; when off, an unscoped root key is created. On
 * success it emits the created key (incl. the one-time secret) for the
 * secret-once dialog.
 */
@Component({
  selector: 'ob-key-create-dialog',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    BrnDialogImports,
    HlmDialogImports,
    HlmButton,
    HlmInput,
    HlmSwitch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-md"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ 'keys.createTitle' | translate }}</h3>
          <p hlmDialogDescription>{{ 'keys.createHint' | translate }}</p>
        </hlm-dialog-header>

        <div class="space-y-3 py-2">
          <label class="block space-y-1.5">
            <span class="text-sm font-medium">{{ 'keys.label' | translate }}</span>
            <input
              hlmInput
              class="w-full"
              autocomplete="off"
              placeholder="e.g. ci-pipeline"
              [ngModel]="label()"
              (ngModelChange)="label.set($event)"
            />
          </label>

          <!-- Scope builder (EPIC-11): optional bucket/prefix/action restriction. -->
          <div class="border-border rounded-md border p-3">
            <label class="flex items-center justify-between gap-2">
              <span class="text-sm font-medium">{{ 'keys.restrictScope' | translate }}</span>
              <hlm-switch
                [checked]="scoped()"
                (checkedChange)="scoped.set($event)"
                [attr.aria-label]="'keys.restrictScope' | translate"
              />
            </label>

            @if (scoped()) {
              <div class="mt-3 space-y-3">
                <label class="block space-y-1.5">
                  <span class="text-muted-foreground text-xs">{{ 'keys.bucket' | translate }}</span>
                  <input
                    hlmInput
                    class="w-full"
                    autocomplete="off"
                    placeholder="tenant-a"
                    [ngModel]="bucket()"
                    (ngModelChange)="bucket.set($event)"
                  />
                </label>
                <label class="block space-y-1.5">
                  <span class="text-muted-foreground text-xs">{{ 'keys.prefix' | translate }}</span>
                  <input
                    hlmInput
                    class="w-full"
                    autocomplete="off"
                    placeholder="uploads/"
                    [ngModel]="prefix()"
                    (ngModelChange)="prefix.set($event)"
                  />
                </label>
                <div class="space-y-1.5">
                  <span class="text-muted-foreground text-xs">{{ 'keys.scopeActions' | translate }}</span>
                  <div class="flex flex-wrap gap-1.5">
                    @for (a of allActions; track a) {
                      <button
                        type="button"
                        hlmBtn
                        [variant]="actions().has(a) ? 'default' : 'outline'"
                        size="sm"
                        (click)="toggleAction(a)"
                      >
                        {{ a }}
                      </button>
                    }
                  </div>
                </div>
              </div>
            }
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
            {{ 'keys.cancel' | translate }}
          </button>
          <button
            hlmBtn
            (click)="submit()"
            [disabled]="creating() || !canSubmit()"
          >
            {{ (creating() ? 'keys.creating' : 'keys.create') | translate }}
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

  // Scope-builder state.
  protected readonly scoped = signal(false);
  protected readonly bucket = signal('');
  protected readonly prefix = signal('');
  protected readonly actions = signal<Set<string>>(new Set());
  protected readonly allActions = SCOPE_ACTIONS;

  protected readonly canSubmit = computed(() => {
    if (!this.label().trim()) return false;
    if (this.scoped() && !this.bucket().trim()) return false;
    return true;
  });

  open(): void {
    this.label.set('');
    this.error.set(null);
    this.creating.set(false);
    this.scoped.set(false);
    this.bucket.set('');
    this.prefix.set('');
    this.actions.set(new Set());
    this.dialog().open();
  }

  protected close(): void {
    if (!this.creating()) this.dialog().close();
  }

  protected toggleAction(a: string): void {
    this.actions.update((set) => {
      const next = new Set(set);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }

  private buildScope(): CreateKeyDtoScope | undefined {
    if (!this.scoped()) return undefined;
    const actions = [...this.actions()];
    const prefix = this.prefix().trim();
    return {
      kind: CreateKeyDtoScopeOneOfKindEnum.Prefix,
      bucket: this.bucket().trim(),
      ...(prefix ? { prefix } : {}),
      ...(actions.length ? { actions } : {}),
    };
  }

  protected async submit(): Promise<void> {
    const label = this.label().trim();
    if (!this.canSubmit() || this.creating()) return;
    this.creating.set(true);
    this.error.set(null);
    try {
      const key = await this.store.create({ label, scope: this.buildScope() });
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
