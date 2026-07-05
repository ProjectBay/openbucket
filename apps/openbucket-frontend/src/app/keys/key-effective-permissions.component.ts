import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { BrnSheetImports } from '@spartan-ng/brain/sheet';
import { HlmSheet, HlmSheetImports } from '@openbucket/spartan-ui/sheet';
import { HlmTableImports } from '@openbucket/spartan-ui/table';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import {
  EffectivePermissionsDto,
  KeySummaryDto,
  SimulateResponseDtoDecisionEnum,
} from '@openbucket/api-client';

import { KeysSignalStore } from './keys.signal-store';

/**
 * Effective-permissions panel (EPIC-11 TASK-3013): a right-side sheet that
 * renders the allow/deny matrix for a key (from `getKeyEffectivePermissions`)
 * plus a one-line simulate input. Read-only, `OnPush`, signals-based. Reflects
 * exactly what the S3 path enforces — the same evaluator server-side.
 */
@Component({
  selector: 'ob-key-effective-permissions',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    BrnSheetImports,
    HlmSheetImports,
    HlmTableImports,
    HlmBadge,
    HlmButton,
    HlmInput,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet
      side="right"
      (closed)="onClosed()"
    >
      <hlm-sheet-content
        *brnSheetContent="let ctx"
        class="w-full sm:max-w-xl"
      >
        <hlm-sheet-header>
          <h3 hlmSheetTitle>{{ 'keys.permissions' | translate }}</h3>
          <p hlmSheetDescription>
            @if (target(); as k) {
              {{ k.label }} · <code class="font-mono text-xs">{{ k.accessKeyId }}</code>
            }
          </p>
        </hlm-sheet-header>

        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-2">
          @if (loading()) {
            <p class="text-muted-foreground text-sm">{{ 'keys.loading' | translate }}</p>
          } @else if (error()) {
            <p class="text-destructive text-sm">{{ error() }}</p>
          } @else if (data(); as d) {
            <div>
              <span
                hlmBadge
                [variant]="d.scoped ? 'secondary' : 'outline'"
                >{{ (d.scoped ? 'keys.scoped' : 'keys.root') | translate }}</span
              >
            </div>

            <!-- Simulate row -->
            <div class="border-border space-y-2 rounded-md border p-3">
              <span class="text-sm font-medium">{{ 'keys.simulate' | translate }}</span>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  hlmInput
                  class="w-36"
                  autocomplete="off"
                  [placeholder]="'keys.action' | translate"
                  [ngModel]="simAction()"
                  (ngModelChange)="simAction.set($event)"
                />
                <input
                  hlmInput
                  class="min-w-0 flex-1"
                  autocomplete="off"
                  [placeholder]="'keys.resource' | translate"
                  [ngModel]="simResource()"
                  (ngModelChange)="simResource.set($event)"
                />
                <button
                  hlmBtn
                  size="sm"
                  [disabled]="simulating() || !simAction().trim() || !simResource().trim()"
                  (click)="runSimulate()"
                >
                  {{ 'keys.run' | translate }}
                </button>
                @if (simDecision(); as dec) {
                  <span
                    hlmBadge
                    [variant]="dec === 'allow' ? 'default' : 'destructive'"
                    >{{ dec }}</span
                  >
                }
              </div>
            </div>

            <!-- Matrix -->
            <div hlmTableContainer>
              <table
                hlmTable
                class="w-full"
              >
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh>{{ 'keys.action' | translate }}</th>
                    <th hlmTh>{{ 'keys.resource' | translate }}</th>
                    <th
                      hlmTh
                      class="text-right"
                    >
                      {{ 'keys.decision' | translate }}
                    </th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (cell of d.matrix; track $index) {
                    <tr hlmTr>
                      <td hlmTd>
                        <code class="font-mono text-xs">{{ cell.action }}</code>
                      </td>
                      <td hlmTd>
                        <code class="font-mono text-xs break-all">{{ cell.resource }}</code>
                      </td>
                      <td
                        hlmTd
                        class="text-right"
                      >
                        <span
                          hlmBadge
                          [variant]="cell.decision === 'allow' ? 'default' : 'destructive'"
                          >{{ cell.decision }}</span
                        >
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class KeyEffectivePermissionsComponent {
  private readonly store = inject(KeysSignalStore);
  private readonly sheet = viewChild.required(HlmSheet);

  protected readonly target = signal<KeySummaryDto | null>(null);
  protected readonly data = signal<EffectivePermissionsDto | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly simAction = signal('GetObject');
  protected readonly simResource = signal('');
  protected readonly simulating = signal(false);
  protected readonly simDecision = signal<SimulateResponseDtoDecisionEnum | null>(null);

  protected readonly scoped = computed(() => this.data()?.scoped ?? false);

  async open(key: KeySummaryDto): Promise<void> {
    this.target.set(key);
    this.data.set(null);
    this.error.set(null);
    this.simDecision.set(null);
    this.simResource.set(`arn:aws:s3:::${key.scope?.bucket ?? 'bucket'}/`);
    this.loading.set(true);
    this.sheet().open();
    try {
      this.data.set(await this.store.effectivePermissions(key.id));
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected onClosed(): void {
    this.target.set(null);
    this.data.set(null);
  }

  protected async runSimulate(): Promise<void> {
    const key = this.target();
    if (!key || this.simulating()) return;
    this.simulating.set(true);
    this.simDecision.set(null);
    try {
      const res = await this.store.simulate(key.id, {
        action: this.simAction().trim(),
        resource: this.simResource().trim(),
      });
      this.simDecision.set(res.decision);
    } catch {
      this.error.set('Simulate failed');
    } finally {
      this.simulating.set(false);
    }
  }
}
