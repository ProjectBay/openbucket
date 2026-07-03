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
import { HlmCheckbox } from '@openbucket/spartan-ui/checkbox';
import { BucketsAdminService } from '@openbucket/api-client';

import { notify } from '../shared/ui/notify';

/** One statement row in the visual builder. */
interface PolicyStatement {
  sid: string;
  effect: 'Allow' | 'Deny';
  principal: string;
  actions: string[];
  resource: string;
}

/** The S3 actions offered as checkboxes (the common ones). */
const COMMON_ACTIONS = [
  's3:GetObject',
  's3:PutObject',
  's3:DeleteObject',
  's3:ListBucket',
  's3:*',
] as const;

/**
 * Visual (form-based) builder for an S3 bucket policy. Statements are listed as
 * summary rows; the add/edit FORM opens in a dialog. Editors work on a local
 * statement model and serialize to an IAM-style policy document (shown read-only
 * below and sent on save).
 */
@Component({
  selector: 'ob-bucket-policy-editor',
  standalone: true,
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmCheckbox,
    HlmDialogImports,
    BrnDialogImports,
  ],
  providers: [provideIcons({ lucidePlus, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <div class="bg-muted/40 text-muted-foreground rounded-md p-3 text-xs">
        A bucket policy grants or denies access using statements. Each statement
        Allows or Denies a set of S3 actions on resources for a principal. A
        common use is to make a bucket's objects publicly readable.
      </div>

      @for (s of statements(); track $index) {
        <div class="flex items-center justify-between gap-3 rounded-md border p-3">
          <div class="min-w-0">
            <span class="truncate font-medium">{{ s.sid || s.effect + ' statement' }}</span>
            <p class="text-muted-foreground truncate text-xs">{{ statementSummary(s) }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button hlmBtn variant="ghost" size="sm" (click)="openEdit($index)">Edit</button>
            <button
              hlmBtn
              variant="ghost"
              size="icon-sm"
              aria-label="Remove statement"
              (click)="removeStatement($index)"
            >
              <ng-icon name="lucideTrash2" class="text-base" />
            </button>
          </div>
        </div>
      } @empty {
        <p class="text-muted-foreground text-sm">
          No policy. Add a statement to grant or deny access.
        </p>
      }

      <div class="flex flex-wrap gap-2">
        <button hlmBtn variant="outline" size="sm" (click)="openAdd()">
          <ng-icon name="lucidePlus" class="text-base" />Add statement
        </button>
      </div>

      <div class="flex gap-2">
        <button hlmBtn size="sm" (click)="save()">Save</button>
        <button hlmBtn variant="outline" size="sm" (click)="clear()">Clear</button>
      </div>

      <pre class="bg-muted/40 overflow-auto rounded-md p-3 font-mono text-xs">{{ previewJson() }}</pre>
    </div>

    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-lg"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ editIndex() === null ? 'Add statement' : 'Edit statement' }}</h3>
          <p hlmDialogDescription>Allow or deny S3 actions on resources for a principal.</p>
        </hlm-dialog-header>

        @if (draft(); as d) {
          <div class="max-h-[65vh] space-y-3 overflow-auto py-2">
            <div class="space-y-1">
              <span class="text-sm font-medium">Sid (optional name)</span>
              <input
                hlmInput
                class="w-full"
                placeholder="Sid"
                [ngModel]="d.sid"
                (ngModelChange)="setDraft('sid', $event)"
              />
            </div>

            <div>
              <p class="mb-1 text-sm font-medium">Effect</p>
              <div class="flex gap-2">
                <button
                  hlmBtn
                  size="sm"
                  [variant]="d.effect === 'Allow' ? 'default' : 'outline'"
                  (click)="setDraft('effect', 'Allow')"
                >
                  Allow
                </button>
                <button
                  hlmBtn
                  size="sm"
                  [variant]="d.effect === 'Deny' ? 'default' : 'outline'"
                  (click)="setDraft('effect', 'Deny')"
                >
                  Deny
                </button>
              </div>
            </div>

            <div>
              <p class="mb-1 text-sm font-medium">Principal</p>
              <input
                hlmInput
                class="w-full"
                placeholder="*"
                [ngModel]="d.principal"
                (ngModelChange)="setDraft('principal', $event)"
              />
              <p class="text-muted-foreground mt-1 text-xs">Who it applies to. '*' = everyone (public). Or an ARN.</p>
            </div>

            <div>
              <p class="mb-1 text-sm font-medium">Actions</p>
              <div class="flex flex-wrap gap-x-4 gap-y-2">
                @for (action of commonActions; track action) {
                  <label class="flex items-center gap-2 text-sm">
                    <hlm-checkbox
                      [checked]="d.actions.includes(action)"
                      (checkedChange)="toggleAction(action, $event)"
                    />
                    {{ action }}
                  </label>
                }
              </div>
              <p class="text-muted-foreground mt-1 text-xs">What the principal may do.</p>
            </div>

            <div>
              <p class="mb-1 text-sm font-medium">Resource</p>
              <input
                hlmInput
                class="w-full"
                [ngModel]="d.resource"
                (ngModelChange)="setDraft('resource', $event)"
              />
              <p class="text-muted-foreground mt-1 text-xs">
                e.g. arn:aws:s3:::&lt;bucket&gt;/* for all objects, or arn:aws:s3:::&lt;bucket&gt; for the bucket itself.
              </p>
            </div>
          </div>
        }

        <hlm-dialog-footer>
          <button hlmBtn variant="outline" (click)="closeDialog()">Cancel</button>
          <button hlmBtn (click)="applyDraft()" [disabled]="!draftValid()">
            {{ editIndex() === null ? 'Add statement' : 'Save statement' }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class BucketPolicyEditorComponent implements OnInit {
  private readonly api = inject(BucketsAdminService);

  readonly bucket = input.required<string>();

  protected readonly commonActions = COMMON_ACTIONS;

  readonly statements = signal<PolicyStatement[]>([]);

  /** The policy document that will be saved, kept in sync for the preview. */
  readonly previewJson = computed(() => JSON.stringify(this.buildPolicy(), null, 2));

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly draft = signal<PolicyStatement | null>(null);
  protected readonly editIndex = signal<number | null>(null);
  protected readonly draftValid = computed(() => {
    const d = this.draft();
    return !!d && d.actions.length > 0 && d.resource.trim() !== '';
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getBucketPolicy(this.bucket()));
      this.statements.set(this.parsePolicy(res.policy));
    } catch {
      this.statements.set([]);
    }
  }

  statementSummary(s: PolicyStatement): string {
    const actions = s.actions.length ? s.actions.join(', ') : 'no actions';
    return `${s.effect} · ${actions} · ${s.principal || '*'}`;
  }

  openAdd(): void {
    this.editIndex.set(null);
    this.draft.set({
      sid: '',
      effect: 'Allow',
      principal: '*',
      actions: [],
      resource: `arn:aws:s3:::${this.bucket()}/*`,
    });
    this.dialog().open();
  }

  openEdit(index: number): void {
    this.editIndex.set(index);
    const s = this.statements()[index];
    this.draft.set({ ...s, actions: [...s.actions] });
    this.dialog().open();
  }

  applyDraft(): void {
    const d = this.draft();
    if (!d || !this.draftValid()) return;
    const at = this.editIndex();
    this.statements.update((list) =>
      at === null ? [...list, d] : list.map((s, i) => (i === at ? d : s)),
    );
    this.closeDialog();
  }

  closeDialog(): void {
    this.dialog().close();
    this.draft.set(null);
  }

  setDraft<K extends keyof PolicyStatement>(field: K, value: PolicyStatement[K]): void {
    this.draft.update((d) => (d ? { ...d, [field]: value } : d));
  }

  toggleAction(action: string, checked: boolean): void {
    this.draft.update((d) => {
      if (!d) return d;
      const actions = checked
        ? d.actions.includes(action)
          ? d.actions
          : [...d.actions, action]
        : d.actions.filter((a) => a !== action);
      return { ...d, actions };
    });
  }

  removeStatement(index: number): void {
    this.statements.update((list) => list.filter((_, i) => i !== index));
  }

  /** Best-effort map an IAM-style document back into the local model. */
  private parsePolicy(policy: { [key: string]: any }): PolicyStatement[] {
    try {
      const raw = policy?.['Statement'];
      const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return list.map((st) => {
        let principal = '*';
        const p = st?.Principal;
        if (typeof p === 'string') {
          principal = p === '*' ? '*' : p;
        } else if (p && typeof p === 'object' && typeof p.AWS === 'string') {
          principal = p.AWS;
        }

        const action = st?.Action;
        const actions: string[] = Array.isArray(action)
          ? action.map((a: any) => String(a))
          : action != null
            ? [String(action)]
            : [];

        const resource = st?.Resource;
        const resourceStr = Array.isArray(resource)
          ? resource.map((r: any) => String(r)).join(', ')
          : resource != null
            ? String(resource)
            : '';

        return {
          sid: typeof st?.Sid === 'string' ? st.Sid : '',
          effect: st?.Effect === 'Deny' ? 'Deny' : 'Allow',
          principal,
          actions,
          resource: resourceStr,
        } satisfies PolicyStatement;
      });
    } catch {
      return [];
    }
  }

  /** Serialize the local model into an IAM-style policy document. */
  private buildPolicy(): { [key: string]: any } {
    return {
      Version: '2012-10-17',
      Statement: this.statements().map((s) => ({
        ...(s.sid ? { Sid: s.sid } : {}),
        Effect: s.effect,
        Principal: s.principal.trim() === '*' ? '*' : { AWS: s.principal.trim() },
        Action: s.actions,
        Resource: s.resource.trim(),
      })),
    };
  }

  async save(): Promise<void> {
    for (const s of this.statements()) {
      if (s.actions.length === 0) {
        notify.error('Each statement needs at least one action');
        return;
      }
      if (!s.resource.trim()) {
        notify.error('Each statement needs a resource');
        return;
      }
    }
    try {
      await firstValueFrom(
        this.api.putBucketPolicy(this.bucket(), { policy: this.buildPolicy() }),
      );
      notify.success('Policy saved');
    } catch {
      notify.error('Failed to save policy');
    }
  }

  async clear(): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteBucketPolicy(this.bucket()));
      this.statements.set([]);
      notify.success('Policy cleared');
    } catch {
      notify.error('Failed to clear policy');
    }
  }
}
