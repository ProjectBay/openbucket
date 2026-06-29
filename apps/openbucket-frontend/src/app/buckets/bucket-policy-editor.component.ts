import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
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
 * Visual (form-based) builder for an S3 bucket policy. Renders inside the
 * bucket-detail "Policy" tab as plain divs (no card chrome). Editors work on a
 * local statement model and serialize to an IAM-style policy document that is
 * shown read-only at the bottom and sent on save.
 */
@Component({
  selector: 'ob-bucket-policy-editor',
  standalone: true,
  imports: [FormsModule, NgIcon, HlmButton, HlmInput, HlmCheckbox],
  providers: [provideIcons({ lucidePlus, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="max-w-2xl space-y-3">
      <div class="bg-muted/40 text-muted-foreground rounded-md p-3 text-xs">
        A bucket policy grants or denies access using statements. Each statement
        Allows or Denies a set of S3 actions on resources for a principal. A
        common use is to make a bucket's objects publicly readable.
      </div>

      @for (s of statements(); track $index) {
        <div class="space-y-2 rounded-md border p-3">
          <div class="flex items-center gap-2">
            <input
              hlmInput
              class="flex-1"
              placeholder="Sid (optional name)"
              [ngModel]="s.sid"
              (ngModelChange)="setField($index, 'sid', $event)"
            />
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

          <div>
            <p class="mb-1 text-sm font-medium">Effect</p>
            <div class="flex gap-2">
              <button
                hlmBtn
                size="sm"
                [variant]="s.effect === 'Allow' ? 'default' : 'outline'"
                (click)="setEffect($index, 'Allow')"
              >
                Allow
              </button>
              <button
                hlmBtn
                size="sm"
                [variant]="s.effect === 'Deny' ? 'default' : 'outline'"
                (click)="setEffect($index, 'Deny')"
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
              [ngModel]="s.principal"
              (ngModelChange)="setField($index, 'principal', $event)"
            />
            <p class="text-muted-foreground mt-1 text-xs">
              Who it applies to. '*' = everyone (public). Or an ARN.
            </p>
          </div>

          <div>
            <p class="mb-1 text-sm font-medium">Actions</p>
            <div class="flex flex-wrap gap-x-4 gap-y-2">
              @for (action of commonActions; track action) {
                <label class="flex items-center gap-2 text-sm">
                  <hlm-checkbox
                    [checked]="s.actions.includes(action)"
                    (checkedChange)="toggleAction($index, action, $event)"
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
              [ngModel]="s.resource"
              (ngModelChange)="setField($index, 'resource', $event)"
            />
            <p class="text-muted-foreground mt-1 text-xs">
              e.g. arn:aws:s3:::&lt;bucket&gt;/* for all objects, or
              arn:aws:s3:::&lt;bucket&gt; for the bucket itself.
            </p>
          </div>
        </div>
      } @empty {
        <p class="text-muted-foreground text-sm">
          No policy. Add a statement to grant or deny access.
        </p>
      }

      <div class="flex flex-wrap gap-2">
        <button hlmBtn variant="outline" size="sm" (click)="addStatement()">
          <ng-icon name="lucidePlus" class="text-base" />Add statement
        </button>
      </div>

      <div class="flex gap-2">
        <button hlmBtn size="sm" (click)="save()">Save</button>
        <button hlmBtn variant="outline" size="sm" (click)="clear()">Clear</button>
      </div>

      <pre class="bg-muted/40 overflow-auto rounded-md p-3 font-mono text-xs">{{ previewJson() }}</pre>
    </div>
  `,
})
export class BucketPolicyEditorComponent implements OnInit {
  private readonly api = inject(BucketsAdminService);

  readonly bucket = input.required<string>();

  protected readonly commonActions = COMMON_ACTIONS;

  readonly statements = signal<PolicyStatement[]>([]);

  /** The policy document that will be saved, kept in sync for the preview. */
  readonly previewJson = computed(() => JSON.stringify(this.buildPolicy(), null, 2));

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getBucketPolicy(this.bucket()));
      this.statements.set(this.parsePolicy(res.policy));
    } catch {
      // 404 = unset (or unexpected shape): start empty.
      this.statements.set([]);
    }
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

  addStatement(): void {
    this.statements.update((list) => [
      ...list,
      {
        sid: '',
        effect: 'Allow',
        principal: '*',
        actions: [],
        resource: `arn:aws:s3:::${this.bucket()}/*`,
      },
    ]);
  }

  removeStatement(index: number): void {
    this.statements.update((list) => list.filter((_, i) => i !== index));
  }

  setField(index: number, field: 'sid' | 'principal' | 'resource', value: string): void {
    this.statements.update((list) =>
      list.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  }

  setEffect(index: number, effect: 'Allow' | 'Deny'): void {
    this.statements.update((list) =>
      list.map((s, i) => (i === index ? { ...s, effect } : s)),
    );
  }

  toggleAction(index: number, action: string, checked: boolean): void {
    this.statements.update((list) =>
      list.map((s, i) => {
        if (i !== index) return s;
        const actions = checked
          ? s.actions.includes(action)
            ? s.actions
            : [...s.actions, action]
          : s.actions.filter((a) => a !== action);
        return { ...s, actions };
      }),
    );
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
