import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
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

/**
 * Visual builder for a bucket's S3 CORS rules — a form, not a raw-JSON editor.
 * Renders inside the bucket-detail "CORS" tab (plain divs, no card chrome).
 */
@Component({
  selector: 'ob-bucket-cors-editor',
  standalone: true,
  imports: [FormsModule, NgIcon, HlmButton, HlmInput, HlmTextarea, HlmCheckbox],
  providers: [provideIcons({ lucidePlus, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <div class="bg-muted/40 text-muted-foreground rounded-md p-3 text-xs">
        CORS lets browser apps hosted on other origins call this bucket's S3 API. Each rule
        grants specific origins permission to use specific HTTP methods.
      </div>

      @for (rule of rules(); track $index) {
        <div class="space-y-2 rounded-md border p-3">
          <div class="flex items-center gap-2">
            <input
              hlmInput
              class="flex-1"
              placeholder="Rule ID (optional)"
              [ngModel]="rule.id"
              (ngModelChange)="setField($index, 'id', $event)"
            />
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

          <div class="space-y-1">
            <span class="text-sm font-medium">Allowed origins</span>
            <textarea
              hlmTextarea
              rows="2"
              class="w-full font-mono text-xs"
              [ngModel]="rule.origins"
              (ngModelChange)="setField($index, 'origins', $event)"
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
                    [checked]="rule.methods.includes(method)"
                    (checkedChange)="toggleMethod($index, method, $event)"
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
              [ngModel]="rule.headers"
              (ngModelChange)="setField($index, 'headers', $event)"
            ></textarea>
            <span class="text-muted-foreground text-xs">
              Request headers the browser may send (* allowed).
            </span>
          </div>

          <div class="space-y-1">
            <span class="text-sm font-medium">Expose headers</span>
            <textarea
              hlmTextarea
              rows="2"
              class="w-full font-mono text-xs"
              [ngModel]="rule.expose"
              (ngModelChange)="setField($index, 'expose', $event)"
            ></textarea>
            <span class="text-muted-foreground text-xs">
              Response headers the browser may read.
            </span>
          </div>

          <div class="space-y-1">
            <span class="text-sm font-medium">Max age (seconds)</span>
            <input
              hlmInput
              type="number"
              class="w-40"
              [ngModel]="rule.maxAgeSeconds"
              (ngModelChange)="setMaxAge($index, $event)"
            />
            <span class="text-muted-foreground text-xs">
              How long browsers cache the preflight response.
            </span>
          </div>
        </div>
      } @empty {
        <p class="text-muted-foreground text-sm">
          No CORS rules. Add one to allow cross-origin browser access.
        </p>
      }

      <button hlmBtn variant="outline" size="sm" (click)="addRule()">
        <ng-icon name="lucidePlus" class="text-base" />
        Add rule
      </button>

      <div class="flex gap-2 pt-1">
        <button hlmBtn size="sm" (click)="save()">Save</button>
        <button hlmBtn variant="outline" size="sm" (click)="clearAll()">Clear all</button>
      </div>
    </div>
  `,
})
export class BucketCorsEditorComponent implements OnInit {
  private readonly api = inject(BucketsAdminService);

  readonly bucket = input.required<string>();

  protected readonly methods = CORS_METHODS;
  protected readonly rules = signal<RuleModel[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getBucketCors(this.bucket()));
      this.rules.set((res.rules ?? []).map((r) => this.toModel(r)));
    } catch {
      // 404 = no CORS config set; start with an empty list.
      this.rules.set([]);
    }
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

  protected setField(index: number, field: 'id' | 'origins' | 'headers' | 'expose', value: string): void {
    this.rules.update((rules) =>
      rules.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }

  protected setMaxAge(index: number, value: number | string | null): void {
    const num =
      value === null || value === '' || value === undefined ? null : Number(value);
    this.rules.update((rules) =>
      rules.map((r, i) =>
        i === index ? { ...r, maxAgeSeconds: num !== null && Number.isNaN(num) ? null : num } : r,
      ),
    );
  }

  protected toggleMethod(index: number, method: CorsMethod, checked: boolean): void {
    this.rules.update((rules) =>
      rules.map((r, i) => {
        if (i !== index) return r;
        const methods = checked
          ? r.methods.includes(method)
            ? r.methods
            : [...r.methods, method]
          : r.methods.filter((m) => m !== method);
        return { ...r, methods };
      }),
    );
  }

  protected addRule(): void {
    this.rules.update((rules) => [
      ...rules,
      { id: '', origins: '*', methods: ['GET'], headers: '', expose: '', maxAgeSeconds: null },
    ]);
  }

  protected removeRule(index: number): void {
    this.rules.update((rules) => rules.filter((_, i) => i !== index));
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
