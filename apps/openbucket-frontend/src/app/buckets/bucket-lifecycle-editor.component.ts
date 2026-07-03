import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import {
  BucketsAdminService,
  LifecycleRuleDto,
  LifecycleRuleDtoStatusEnum,
} from '@openbucket/api-client';

import { notify } from '../shared/ui/notify';

/** Local, editable mirror of {@link LifecycleRuleDto}. Status is held as a boolean
 * (`enabled`) and numeric fields as `number | null` so they bind cleanly to the
 * form controls; both are mapped back to the DTO shape on save. */
interface RuleModel {
  id: string;
  enabled: boolean;
  prefix: string;
  expirationDays: number | null;
  noncurrentVersionExpirationDays: number | null;
  abortIncompleteMultipartUploadDays: number | null;
  expiredObjectDeleteMarker: boolean;
}

type NumField =
  | 'expirationDays'
  | 'noncurrentVersionExpirationDays'
  | 'abortIncompleteMultipartUploadDays';

function blankRule(index: number): RuleModel {
  return {
    id: 'rule-' + (index + 1),
    enabled: true,
    prefix: '',
    expirationDays: null,
    noncurrentVersionExpirationDays: null,
    abortIncompleteMultipartUploadDays: null,
    expiredObjectDeleteMarker: false,
  };
}

/**
 * Visual (form-based) builder for S3 bucket lifecycle rules. Rules are listed as
 * summary rows; the add/edit FORM opens in a dialog. Reads/writes config over the
 * admin endpoints; a 404 from GET means "no lifecycle configured".
 */
@Component({
  selector: 'ob-bucket-lifecycle-editor',
  standalone: true,
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmSwitch,
    HlmBadge,
    HlmDialogImports,
    BrnDialogImports,
  ],
  providers: [provideIcons({ lucidePlus, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <div class="bg-muted/40 text-muted-foreground rounded-md p-3 text-xs">
        Lifecycle rules automatically delete objects after a set age, expire old (noncurrent)
        versions, and abort stalled multipart uploads. Use them to keep storage costs under control.
      </div>

      <div class="space-y-2">
        @for (rule of rules(); track $index) {
          <div class="flex items-center justify-between gap-3 rounded-md border p-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{{ rule.id }}</span>
                <span hlmBadge [variant]="rule.enabled ? 'default' : 'secondary'">
                  {{ rule.enabled ? 'Enabled' : 'Disabled' }}
                </span>
              </div>
              <p class="text-muted-foreground truncate text-xs">{{ ruleSummary(rule) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button hlmBtn variant="ghost" size="sm" (click)="openEdit($index)">Edit</button>
              <button
                hlmBtn
                variant="ghost"
                size="icon-sm"
                aria-label="Remove rule"
                (click)="removeRule($index)"
              >
                <ng-icon name="lucideTrash2" class="text-base" />
              </button>
            </div>
          </div>
        } @empty {
          <p class="text-muted-foreground text-sm">
            No lifecycle rules. Add one to start expiring objects.
          </p>
        }
      </div>

      <button hlmBtn variant="outline" size="sm" (click)="openAdd()">
        <ng-icon name="lucidePlus" class="text-base" />Add rule
      </button>

      <div class="flex gap-2 border-t pt-4">
        <button hlmBtn size="sm" [disabled]="saving()" (click)="save()">Save</button>
        <button hlmBtn variant="outline" size="sm" (click)="clearAll()">Clear all</button>
      </div>
    </div>

    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-lg"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ editIndex() === null ? 'Add lifecycle rule' : 'Edit lifecycle rule' }}</h3>
          <p hlmDialogDescription>Objects matching this rule are expired automatically.</p>
        </hlm-dialog-header>

        @if (draft(); as d) {
          <div class="max-h-[65vh] space-y-3 overflow-auto py-2">
            <div class="flex items-center gap-3">
              <input
                hlmInput
                class="flex-1"
                placeholder="Rule ID"
                aria-label="Rule ID"
                [ngModel]="d.id"
                (ngModelChange)="setDraft('id', $event)"
              />
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">Enabled</span>
                <hlm-switch
                  aria-label="Rule enabled"
                  [checked]="d.enabled"
                  (checkedChange)="setDraft('enabled', $event)"
                />
              </div>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Prefix</span>
              <input
                hlmInput
                class="w-full"
                placeholder="e.g. logs/"
                [ngModel]="d.prefix"
                (ngModelChange)="setDraft('prefix', $event)"
              />
              <span class="text-muted-foreground text-xs">
                Applies only to keys under this prefix (blank = whole bucket).
              </span>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Expire objects after</span>
              <input
                hlmInput
                type="number"
                min="1"
                class="w-full"
                placeholder="days"
                [ngModel]="d.expirationDays"
                (ngModelChange)="setDraftNum('expirationDays', $event)"
              />
              <span class="text-muted-foreground text-xs">Delete objects this many days after creation.</span>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Expire noncurrent versions after</span>
              <input
                hlmInput
                type="number"
                min="1"
                class="w-full"
                placeholder="days"
                [ngModel]="d.noncurrentVersionExpirationDays"
                (ngModelChange)="setDraftNum('noncurrentVersionExpirationDays', $event)"
              />
              <span class="text-muted-foreground text-xs">On versioned buckets, delete old versions after N days.</span>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Abort incomplete uploads after</span>
              <input
                hlmInput
                type="number"
                min="1"
                class="w-full"
                placeholder="days"
                [ngModel]="d.abortIncompleteMultipartUploadDays"
                (ngModelChange)="setDraftNum('abortIncompleteMultipartUploadDays', $event)"
              />
              <span class="text-muted-foreground text-xs">Clean up multipart uploads not finished within N days.</span>
            </div>

            <div class="flex items-center justify-between gap-3 pt-1">
              <div class="flex flex-col">
                <span class="text-sm font-medium">Remove expired delete markers</span>
                <span class="text-muted-foreground text-xs">Delete leftover delete markers once no versions remain.</span>
              </div>
              <hlm-switch
                aria-label="Remove expired delete markers"
                [checked]="d.expiredObjectDeleteMarker"
                (checkedChange)="setDraft('expiredObjectDeleteMarker', $event)"
              />
            </div>
          </div>
        }

        <hlm-dialog-footer>
          <button hlmBtn variant="outline" (click)="closeDialog()">Cancel</button>
          <button hlmBtn (click)="applyDraft()" [disabled]="!draftValid()">
            {{ editIndex() === null ? 'Add rule' : 'Save rule' }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class BucketLifecycleEditorComponent implements OnInit {
  private readonly api = inject(BucketsAdminService);

  readonly bucket = input.required<string>();

  readonly rules = signal<RuleModel[]>([]);
  readonly saving = signal(false);

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly draft = signal<RuleModel | null>(null);
  protected readonly editIndex = signal<number | null>(null);
  protected readonly draftValid = computed(() => !!this.draft()?.id.trim());

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const config = await firstValueFrom(this.api.getBucketLifecycle(this.bucket()));
      this.rules.set((config.rules ?? []).map((r) => this.toModel(r)));
    } catch {
      this.rules.set([]);
    }
  }

  ruleSummary(r: RuleModel): string {
    const parts: string[] = [r.prefix.trim() ? `Prefix: ${r.prefix.trim()}` : 'Whole bucket'];
    if (this.isPositive(r.expirationDays)) parts.push(`Expire ${r.expirationDays}d`);
    if (this.isPositive(r.noncurrentVersionExpirationDays))
      parts.push(`Noncurrent ${r.noncurrentVersionExpirationDays}d`);
    if (this.isPositive(r.abortIncompleteMultipartUploadDays))
      parts.push(`Abort MPU ${r.abortIncompleteMultipartUploadDays}d`);
    if (r.expiredObjectDeleteMarker) parts.push('Clean delete markers');
    return parts.join(' · ');
  }

  openAdd(): void {
    this.editIndex.set(null);
    this.draft.set(blankRule(this.rules().length));
    this.dialog().open();
  }

  openEdit(index: number): void {
    this.editIndex.set(index);
    this.draft.set({ ...this.rules()[index] });
    this.dialog().open();
  }

  applyDraft(): void {
    const d = this.draft();
    if (!d || !d.id.trim()) return;
    const at = this.editIndex();
    this.rules.update((rules) =>
      at === null ? [...rules, d] : rules.map((r, i) => (i === at ? d : r)),
    );
    this.closeDialog();
  }

  closeDialog(): void {
    this.dialog().close();
    this.draft.set(null);
  }

  setDraft<K extends keyof RuleModel>(field: K, value: RuleModel[K]): void {
    this.draft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  setDraftNum(field: NumField, value: number | string | null): void {
    const num = value === null || value === '' ? null : Number(value);
    this.setDraft(field, Number.isFinite(num as number) ? (num as number) : null);
  }

  removeRule(index: number): void {
    this.rules.update((rules) => rules.filter((_, i) => i !== index));
  }

  async save(): Promise<void> {
    const models = this.rules();
    if (models.some((r) => !r.id.trim())) {
      notify.error('Every rule needs an ID');
      return;
    }

    const rules: LifecycleRuleDto[] = models.map((r) => {
      const dto: LifecycleRuleDto = {
        id: r.id.trim(),
        status: r.enabled
          ? LifecycleRuleDtoStatusEnum.Enabled
          : LifecycleRuleDtoStatusEnum.Disabled,
      };
      const prefix = r.prefix.trim();
      if (prefix) dto.prefix = prefix;
      if (this.isPositive(r.expirationDays)) dto.expirationDays = r.expirationDays;
      if (this.isPositive(r.noncurrentVersionExpirationDays)) {
        dto.noncurrentVersionExpirationDays = r.noncurrentVersionExpirationDays;
      }
      if (this.isPositive(r.abortIncompleteMultipartUploadDays)) {
        dto.abortIncompleteMultipartUploadDays = r.abortIncompleteMultipartUploadDays;
      }
      if (r.expiredObjectDeleteMarker) dto.expiredObjectDeleteMarker = true;
      return dto;
    });

    this.saving.set(true);
    try {
      await firstValueFrom(this.api.putBucketLifecycle(this.bucket(), { rules }));
      notify.success('Lifecycle rules saved');
    } catch {
      notify.error('Failed to save lifecycle rules');
    } finally {
      this.saving.set(false);
    }
  }

  async clearAll(): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteBucketLifecycle(this.bucket()));
      this.rules.set([]);
      notify.success('Lifecycle rules cleared');
    } catch {
      notify.error('Failed to clear lifecycle rules');
    }
  }

  private toModel(r: LifecycleRuleDto): RuleModel {
    return {
      id: r.id,
      enabled: r.status === LifecycleRuleDtoStatusEnum.Enabled,
      prefix: r.prefix ?? '',
      expirationDays: r.expirationDays ?? null,
      noncurrentVersionExpirationDays: r.noncurrentVersionExpirationDays ?? null,
      abortIncompleteMultipartUploadDays: r.abortIncompleteMultipartUploadDays ?? null,
      expiredObjectDeleteMarker: r.expiredObjectDeleteMarker ?? false,
    };
  }

  private isPositive(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }
}
