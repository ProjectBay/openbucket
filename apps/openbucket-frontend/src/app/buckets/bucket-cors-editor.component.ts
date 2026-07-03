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
import { HlmTextarea } from '@openbucket/spartan-ui/textarea';
import { HlmCheckbox } from '@openbucket/spartan-ui/checkbox';
import {
  BucketsAdminService,
  CorsRuleDto,
  CorsRuleDtoAllowedMethodsEnum,
} from '@openbucket/api-client';

import { notify } from '../shared/ui/notify';

/** The five S3 CORS methods, rendered as a checkbox row per rule. */
type CorsMethod = 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD';
const CORS_METHODS: readonly CorsMethod[] = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'];

/**
 * Local, editable shape of a CORS rule. Origins/headers are edited as multiline
 * strings (one entry per line) and only split back into arrays on save; methods
 * are kept as a string[] that the checkbox row toggles membership in.
 */
interface RuleModel {
  id: string;
  origins: string;
  methods: CorsMethod[];
  headers: string;
  expose: string;
  maxAgeSeconds: number | null;
}

function blankRule(): RuleModel {
  return { id: '', origins: '*', methods: ['GET'], headers: '', expose: '', maxAgeSeconds: null };
}

/**
 * Visual builder for a bucket's S3 CORS rules — a form, not a raw-JSON editor.
 * Rules are listed as summary rows; the add/edit FORM opens in a dialog.
 */
@Component({
  selector: 'ob-bucket-cors-editor',
  standalone: true,
  imports: [
    FormsModule,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmTextarea,
    HlmCheckbox,
    HlmDialogImports,
    BrnDialogImports,
  ],
  providers: [provideIcons({ lucidePlus, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <div class="bg-muted/40 text-muted-foreground rounded-md p-3 text-xs">
        CORS lets browser apps hosted on other origins call this bucket's S3 API. Each rule
        grants specific origins permission to use specific HTTP methods.
      </div>

      @for (rule of rules(); track $index) {
        <div class="flex items-center justify-between gap-3 rounded-md border p-3">
          <div class="min-w-0">
            <span class="truncate font-medium">{{ rule.id || 'Rule ' + ($index + 1) }}</span>
            <p class="text-muted-foreground truncate text-xs">{{ corsSummary(rule) }}</p>
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
          No CORS rules. Add one to allow cross-origin browser access.
        </p>
      }

      <button hlmBtn variant="outline" size="sm" (click)="openAdd()">
        <ng-icon name="lucidePlus" class="text-base" />
        Add rule
      </button>

      <div class="flex gap-2 pt-1">
        <button hlmBtn size="sm" (click)="save()">Save</button>
        <button hlmBtn variant="outline" size="sm" (click)="clearAll()">Clear all</button>
      </div>
    </div>

    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="sm:max-w-lg"
      >
        <hlm-dialog-header>
          <h3 hlmDialogTitle>{{ editIndex() === null ? 'Add CORS rule' : 'Edit CORS rule' }}</h3>
          <p hlmDialogDescription>Grant specific origins access to specific methods.</p>
        </hlm-dialog-header>

        @if (draft(); as d) {
          <div class="max-h-[65vh] space-y-3 overflow-auto py-2">
            <div class="space-y-1">
              <span class="text-sm font-medium">Rule ID (optional)</span>
              <input
                hlmInput
                class="w-full"
                placeholder="Rule ID"
                [ngModel]="d.id"
                (ngModelChange)="setDraft('id', $event)"
              />
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Allowed origins</span>
              <textarea
                hlmTextarea
                rows="2"
                class="w-full font-mono text-xs"
                [ngModel]="d.origins"
                (ngModelChange)="setDraft('origins', $event)"
              ></textarea>
              <span class="text-muted-foreground text-xs">
                One per line. e.g. https://app.example.com — or * for any origin.
              </span>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Allowed methods</span>
              <div class="flex flex-wrap gap-4">
                @for (method of methods; track method) {
                  <label class="flex items-center gap-2 text-sm">
                    <hlm-checkbox
                      [checked]="d.methods.includes(method)"
                      (checkedChange)="toggleMethod(method, $event)"
                    />
                    {{ method }}
                  </label>
                }
              </div>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Allowed headers</span>
              <textarea
                hlmTextarea
                rows="2"
                class="w-full font-mono text-xs"
                [ngModel]="d.headers"
                (ngModelChange)="setDraft('headers', $event)"
              ></textarea>
              <span class="text-muted-foreground text-xs">Request headers the browser may send (* allowed).</span>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Expose headers</span>
              <textarea
                hlmTextarea
                rows="2"
                class="w-full font-mono text-xs"
                [ngModel]="d.expose"
                (ngModelChange)="setDraft('expose', $event)"
              ></textarea>
              <span class="text-muted-foreground text-xs">Response headers the browser may read.</span>
            </div>

            <div class="space-y-1">
              <span class="text-sm font-medium">Max age (seconds)</span>
              <input
                hlmInput
                type="number"
                class="w-40"
                [ngModel]="d.maxAgeSeconds"
                (ngModelChange)="setDraftMaxAge($event)"
              />
              <span class="text-muted-foreground text-xs">How long browsers cache the preflight response.</span>
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
export class BucketCorsEditorComponent implements OnInit {
  private readonly api = inject(BucketsAdminService);

  readonly bucket = input.required<string>();

  protected readonly methods = CORS_METHODS;
  protected readonly rules = signal<RuleModel[]>([]);

  private readonly dialog = viewChild.required(HlmDialog);
  protected readonly draft = signal<RuleModel | null>(null);
  protected readonly editIndex = signal<number | null>(null);
  protected readonly draftValid = computed(() => {
    const d = this.draft();
    return !!d && this.lines(d.origins).length > 0 && d.methods.length > 0;
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getBucketCors(this.bucket()));
      this.rules.set((res.rules ?? []).map((r) => this.toModel(r)));
    } catch {
      this.rules.set([]);
    }
  }

  corsSummary(r: RuleModel): string {
    const methods = r.methods.join(', ') || 'no methods';
    const origins = this.lines(r.origins);
    const originText =
      origins.length === 0
        ? 'no origins'
        : origins.length === 1
          ? origins[0]
          : `${origins[0]} (+${origins.length - 1})`;
    return `${methods} · ${originText}`;
  }

  openAdd(): void {
    this.editIndex.set(null);
    this.draft.set(blankRule());
    this.dialog().open();
  }

  openEdit(index: number): void {
    this.editIndex.set(index);
    this.draft.set({ ...this.rules()[index], methods: [...this.rules()[index].methods] });
    this.dialog().open();
  }

  applyDraft(): void {
    const d = this.draft();
    if (!d || !this.draftValid()) return;
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

  setDraftMaxAge(value: number | string | null): void {
    const num = value === null || value === '' || value === undefined ? null : Number(value);
    this.setDraft('maxAgeSeconds', num !== null && Number.isNaN(num) ? null : num);
  }

  toggleMethod(method: CorsMethod, checked: boolean): void {
    this.draft.update((d) => {
      if (!d) return d;
      const methods = checked
        ? d.methods.includes(method)
          ? d.methods
          : [...d.methods, method]
        : d.methods.filter((m) => m !== method);
      return { ...d, methods };
    });
  }

  removeRule(index: number): void {
    this.rules.update((rules) => rules.filter((_, i) => i !== index));
  }

  private toModel(rule: CorsRuleDto): RuleModel {
    return {
      id: rule.id ?? '',
      origins: (rule.allowedOrigins ?? []).join('\n'),
      methods: [...(rule.allowedMethods ?? [])] as CorsMethod[],
      headers: (rule.allowedHeaders ?? []).join('\n'),
      expose: (rule.exposeHeaders ?? []).join('\n'),
      maxAgeSeconds: rule.maxAgeSeconds ?? null,
    };
  }

  protected async save(): Promise<void> {
    const rules: CorsRuleDto[] = [];
    for (const r of this.rules()) {
      const allowedOrigins = this.lines(r.origins);
      if (allowedOrigins.length === 0) {
        notify.error('Each rule needs at least one allowed origin');
        return;
      }
      if (r.methods.length === 0) {
        notify.error('Each rule needs at least one allowed method');
        return;
      }
      const allowedHeaders = this.lines(r.headers);
      const exposeHeaders = this.lines(r.expose);
      const dto: CorsRuleDto = {
        allowedOrigins,
        allowedMethods: r.methods.map((m) => m as CorsRuleDtoAllowedMethodsEnum),
      };
      const id = r.id.trim();
      if (id) dto.id = id;
      if (allowedHeaders.length > 0) dto.allowedHeaders = allowedHeaders;
      if (exposeHeaders.length > 0) dto.exposeHeaders = exposeHeaders;
      if (r.maxAgeSeconds !== null) dto.maxAgeSeconds = r.maxAgeSeconds;
      rules.push(dto);
    }

    try {
      await firstValueFrom(this.api.putBucketCors(this.bucket(), { rules }));
      notify.success('CORS rules saved');
    } catch {
      notify.error('Failed to save CORS rules');
    }
  }

  protected async clearAll(): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteBucketCors(this.bucket()));
      this.rules.set([]);
      notify.success('CORS rules cleared');
    } catch {
      notify.error('Failed to clear CORS rules');
    }
  }

  /** Split a multiline field into trimmed, non-empty lines. */
  private lines(value: string): string[] {
    return value
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
