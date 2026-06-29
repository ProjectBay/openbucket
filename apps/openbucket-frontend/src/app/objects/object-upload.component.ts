import { HttpClient, HttpEventType } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCloudUpload, lucideRotateCcw, lucideUpload, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmProgressImports } from '@openbucket/spartan-ui/progress';

import { notify } from '../shared/ui/notify';

interface UploadItem {
  id: string;
  name: string; // display (folder-relative or file name)
  key: string; // full object key (prefix + name)
  file: File;
  progress: number;
  status: 'uploading' | 'done' | 'error' | 'canceled';
  versionId?: string;
  sub?: Subscription;
}

/**
 * Drag-and-drop / file-picker upload (§5.14, overhauled STORY-0606). Each file's
 * key is `encodeURIComponent(prefix + name)` — encoded EXACTLY once; the backend
 * decodes once. PUTs to the admin object endpoint with progress; per-file
 * cancel/retry, an aggregate footer + summary toast, version-id surfacing, and an
 * optional folder upload.
 */
@Component({
  standalone: true,
  selector: 'ob-object-upload',
  imports: [NgIcon, TranslateModule, HlmButton, HlmProgressImports],
  providers: [provideIcons({ lucideCloudUpload, lucideRotateCcw, lucideUpload, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2">
      <label
        class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors"
        [class.border-primary]="dragOver()"
        [class.bg-accent]="dragOver()"
        [class.text-muted-foreground]="!dragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      >
        <ng-icon
          name="lucideCloudUpload"
          class="text-2xl"
          aria-hidden="true"
        />
        <span class="font-medium"
          >{{ 'upload.uploadTo' | translate }}
          {{ prefix || ('upload.bucketRoot' | translate) }}</span
        >
        <span class="text-xs">{{ 'upload.dropHint' | translate }}</span>
        <input
          type="file"
          multiple
          class="sr-only"
          (change)="onPick($event)"
        />
      </label>

      <div class="flex items-center gap-2">
        <label
          hlmBtn
          variant="outline"
          size="sm"
          class="cursor-pointer"
        >
          <ng-icon
            name="lucideUpload"
            class="text-base"
          />
          {{ 'upload.browse' | translate }}
          <input
            type="file"
            multiple
            class="sr-only"
            (change)="onPick($event)"
          />
        </label>
        <label
          hlmBtn
          variant="ghost"
          size="sm"
          class="cursor-pointer"
        >
          {{ 'upload.folder' | translate }}
          <input
            type="file"
            multiple
            webkitdirectory
            class="sr-only"
            (change)="onPick($event)"
          />
        </label>
      </div>

      @if (uploads().length > 0) {
        <div class="space-y-2 pt-1">
          @for (u of uploads(); track u.id) {
            <div class="flex items-center gap-2 text-sm">
              <span
                class="w-48 truncate"
                [title]="u.name"
                >{{ u.name }}</span
              >
              <hlm-progress
                class="h-2 flex-1"
                [value]="u.progress"
              >
                <hlm-progress-indicator />
              </hlm-progress>
              @switch (u.status) {
                @case ('uploading') {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    [attr.aria-label]="'upload.cancel' | translate"
                    (click)="cancel(u)"
                  >
                    <ng-icon
                      name="lucideX"
                      class="text-base"
                    />
                  </button>
                }
                @case ('error') {
                  <span class="text-destructive text-xs">{{ 'upload.failed' | translate }}</span>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    [attr.aria-label]="'upload.retry' | translate"
                    (click)="retry(u)"
                  >
                    <ng-icon
                      name="lucideRotateCcw"
                      class="text-base"
                    />
                  </button>
                }
                @case ('canceled') {
                  <span class="text-muted-foreground text-xs">{{ 'upload.canceled' | translate }}</span>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    [attr.aria-label]="'upload.retry' | translate"
                    (click)="retry(u)"
                  >
                    <ng-icon
                      name="lucideRotateCcw"
                      class="text-base"
                    />
                  </button>
                }
                @case ('done') {
                  <span class="text-muted-foreground text-xs">
                    {{ 'upload.done' | translate }}@if (u.versionId) {
                      · v{{ u.versionId.slice(0, 8) }}
                    }
                  </span>
                }
              }
            </div>
          }
          <p class="text-muted-foreground text-xs">{{ summary() }}</p>
        </div>
      }
    </div>
  `,
})
export class ObjectUploadComponent {
  private readonly http = inject(HttpClient);

  @Input({ required: true }) bucket!: string;
  @Input() prefix = '';
  @Output() uploaded = new EventEmitter<string>(); // emits the (decoded) key

  readonly uploads = signal<UploadItem[]>([]);
  readonly dragOver = signal(false);

  private summaryShown = true;

  readonly summary = computed(() => {
    const all = this.uploads();
    const done = all.filter((u) => u.status === 'done').length;
    const failed = all.filter((u) => u.status === 'error').length;
    return `${done}/${all.length} uploaded${failed ? `, ${failed} failed` : ''}`;
  });

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) this.startMany(e.dataTransfer.files);
  }

  onPick(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files) this.startMany(input.files);
    input.value = ''; // allow re-picking the same file
  }

  cancel(u: UploadItem): void {
    u.sub?.unsubscribe();
    this.patch(u.id, { status: 'canceled' });
    this.maybeSummary();
  }

  retry(u: UploadItem): void {
    this.summaryShown = false;
    this.upload(u);
  }

  private startMany(list: FileList): void {
    const items: UploadItem[] = Array.from(list).map((file) => {
      const name = file.webkitRelativePath || file.name;
      return {
        id: crypto.randomUUID(),
        name,
        key: this.prefix + name,
        file,
        progress: 0,
        status: 'uploading' as const,
      };
    });
    if (items.length === 0) return;
    this.summaryShown = false;
    this.uploads.update((arr) => [...arr, ...items]);
    for (const item of items) this.upload(item);
  }

  private upload(item: UploadItem): void {
    const url = `/api/admin/buckets/${this.bucket}/objects/${encodeURIComponent(item.key)}`;
    this.patch(item.id, { status: 'uploading', progress: 0 });
    const sub = this.http
      .put(url, item.file, {
        headers: { 'Content-Type': item.file.type || 'application/octet-stream' },
        reportProgress: true,
        observe: 'events',
      })
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.patch(item.id, { progress: Math.round((100 * event.loaded) / event.total) });
          } else if (event.type === HttpEventType.Response) {
            const versionId = event.headers.get('x-amz-version-id') ?? undefined;
            this.patch(item.id, { progress: 100, status: 'done', versionId });
            this.uploaded.emit(item.key);
            this.scheduleClear(item.id);
            this.maybeSummary();
          }
        },
        error: () => {
          this.patch(item.id, { status: 'error' });
          this.maybeSummary();
        },
      });
    this.patch(item.id, { sub });
  }

  /** Fire one summary toast once every upload in the batch has settled. */
  private maybeSummary(): void {
    if (this.summaryShown) return;
    const all = this.uploads();
    if (all.some((u) => u.status === 'uploading')) return;
    this.summaryShown = true;
    const done = all.filter((u) => u.status === 'done').length;
    const failed = all.filter((u) => u.status === 'error').length;
    if (failed > 0) notify.error(`Uploaded ${done}, ${failed} failed`);
    else if (done > 0) notify.success(`Uploaded ${done} file${done === 1 ? '' : 's'}`);
  }

  private scheduleClear(id: string): void {
    setTimeout(() => {
      this.uploads.update((arr) => arr.filter((u) => u.id !== id || u.status !== 'done'));
    }, 4000);
  }

  private patch(id: string, fields: Partial<UploadItem>): void {
    this.uploads.update((arr) => arr.map((u) => (u.id === id ? { ...u, ...fields } : u)));
  }
}
