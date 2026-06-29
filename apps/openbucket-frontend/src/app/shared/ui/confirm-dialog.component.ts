import { ChangeDetectionStrategy, Component, computed, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { BrnAlertDialogImports } from '@spartan-ng/brain/alert-dialog';
import { HlmAlertDialog, HlmAlertDialogImports } from '@openbucket/spartan-ui/alert-dialog';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';

/**
 * Reusable, accessible confirmation dialog (STORY-0600 / TASK-1801) on the
 * spartan alert-dialog primitives. Opened programmatically — `confirm()` returns
 * a Promise<boolean> resolved true on the action and false on cancel/Escape.
 * Focus-trap, focus-restore and Escape come from BrnDialog/CDK. Supports a
 * `destructive` style and an optional `confirmPhrase` type-to-confirm guard.
 */
@Component({
  selector: 'ob-confirm-dialog',
  standalone: true,
  imports: [FormsModule, HlmAlertDialogImports, BrnAlertDialogImports, HlmButton, HlmInput, NgIcon],
  providers: [provideIcons({ lucideTriangleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-alert-dialog (closed)="onClosed()">
      <hlm-alert-dialog-content *brnAlertDialogContent="let ctx">
        <hlm-alert-dialog-header>
          <h3 hlmAlertDialogTitle class="flex items-center gap-2">
            @if (destructive()) {
              <ng-icon name="lucideTriangleAlert" class="text-destructive" />
            }
            {{ title() }}
          </h3>
          @if (description()) {
            <p hlmAlertDialogDescription>{{ description() }}</p>
          }
        </hlm-alert-dialog-header>

        @if (confirmPhrase(); as phrase) {
          <label class="block space-y-1.5 py-2 text-sm">
            <span class="text-muted-foreground">
              Type <code class="rounded bg-muted px-1 font-mono">{{ phrase }}</code> to confirm
            </span>
            <input
              hlmInput
              class="w-full"
              autocomplete="off"
              [ngModel]="typed()"
              (ngModelChange)="typed.set($event)"
              (keyup.enter)="resolve(true)"
            />
          </label>
        }

        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel (click)="resolve(false)">{{ cancelLabel() }}</button>
          <button
            hlmAlertDialogAction
            [variant]="destructive() ? 'destructive' : 'default'"
            [disabled]="!canConfirm()"
            (click)="resolve(true)"
          >
            {{ confirmLabel() }}
          </button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class ConfirmDialogComponent {
  readonly title = input('Are you sure?');
  readonly description = input('');
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly destructive = input(false);
  /** When set, the action button stays disabled until the user types this phrase. */
  readonly confirmPhrase = input<string | null>(null);

  private readonly dialog = viewChild.required(HlmAlertDialog);
  protected readonly typed = signal('');
  private resolver: ((value: boolean) => void) | null = null;

  protected readonly canConfirm = computed(() => {
    const phrase = this.confirmPhrase();
    return !phrase || this.typed() === phrase;
  });

  /** Open the dialog; resolves true if confirmed, false if cancelled/dismissed. */
  confirm(): Promise<boolean> {
    this.typed.set('');
    this.dialog().open();
    return new Promise<boolean>((resolve) => (this.resolver = resolve));
  }

  protected resolve(value: boolean): void {
    if (value && !this.canConfirm()) return;
    this.dialog().close();
    this.settle(value);
  }

  protected onClosed(): void {
    this.settle(false);
  }

  private settle(value: boolean): void {
    const resolver = this.resolver;
    this.resolver = null;
    resolver?.(value);
  }
}
