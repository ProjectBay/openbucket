import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideUpload, lucideDatabase, lucideServer } from '@ng-icons/lucide';

import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';

import { BucketsAdminService } from '@openbucket/api-client';
import { notify } from '../shared/ui/notify';
import { ConfirmDialogComponent } from '../shared/ui/confirm-dialog.component';

/**
 * Admin Backup & Restore. Two scopes:
 *  - a single bucket (pick from the dropdown), and
 *  - the whole instance (all buckets + objects).
 * Backup downloads a .zip; restore uploads a .zip and RESETS the target to it
 * (destructive — guarded by a type-to-confirm dialog).
 */
@Component({
  selector: 'ob-backup-restore',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslateModule, NgIcon, HlmCardImports, HlmButton, ConfirmDialogComponent],
  providers: [provideIcons({ lucideDownload, lucideUpload, lucideDatabase, lucideServer })],
  template: `
    <div class="space-y-6 p-6">
      <!-- Per-bucket -->
      <section hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle class="flex items-center gap-2">
            <ng-icon name="lucideDatabase" size="18" /> {{ 'backupRestore.bucket.title' | translate }}
          </h3>
          <p hlmCardDescription>{{ 'backupRestore.bucket.description' | translate }}</p>
        </div>
        <div hlmCardContent class="space-y-4">
          <label class="block space-y-1">
            <span class="text-muted-foreground text-sm">{{ 'backupRestore.bucket.select' | translate }}</span>
            <select
              class="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              [ngModel]="selectedBucket()"
              (ngModelChange)="selectedBucket.set($event)"
            >
              <option value="" disabled>{{ 'backupRestore.bucket.selectPlaceholder' | translate }}</option>
              @for (b of buckets(); track b) {
                <option [value]="b">{{ b }}</option>
              }
            </select>
          </label>
          <div class="flex flex-wrap gap-2">
            <button hlmBtn size="sm" [disabled]="!selectedBucket() || busy()" (click)="downloadBucketBackup()">
              <ng-icon name="lucideDownload" size="16" class="mr-1.5" />
              {{ 'backupRestore.bucket.download' | translate }}
            </button>
            <button
              hlmBtn
              size="sm"
              variant="outline"
              [disabled]="!selectedBucket() || busy()"
              (click)="bucketPicker.click()"
            >
              <ng-icon name="lucideUpload" size="16" class="mr-1.5" />
              {{ 'backupRestore.bucket.restore' | translate }}
            </button>
            <input #bucketPicker type="file" accept=".zip,application/zip" class="hidden" (change)="onBucketRestore($event)" />
          </div>
        </div>
      </section>

      <!-- Whole instance -->
      <section hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle class="flex items-center gap-2">
            <ng-icon name="lucideServer" size="18" /> {{ 'backupRestore.instance.title' | translate }}
          </h3>
          <p hlmCardDescription>{{ 'backupRestore.instance.description' | translate }}</p>
        </div>
        <div hlmCardContent class="space-y-4">
          <div class="flex flex-wrap gap-2">
            <button hlmBtn size="sm" [disabled]="busy()" (click)="downloadInstanceBackup()">
              <ng-icon name="lucideDownload" size="16" class="mr-1.5" />
              {{ 'backupRestore.instance.download' | translate }}
            </button>
            <button hlmBtn size="sm" variant="destructive" [disabled]="busy()" (click)="instancePicker.click()">
              <ng-icon name="lucideUpload" size="16" class="mr-1.5" />
              {{ 'backupRestore.instance.restore' | translate }}
            </button>
            <input #instancePicker type="file" accept=".zip,application/zip" class="hidden" (change)="onInstanceRestore($event)" />
          </div>
          <p class="text-muted-foreground text-xs">{{ 'backupRestore.resetWarning' | translate }}</p>
        </div>
      </section>

      <ob-confirm-dialog
        [title]="confirmTitle()"
        [description]="confirmDesc()"
        [confirmLabel]="'backupRestore.confirmLabel' | translate"
        [destructive]="true"
        [confirmPhrase]="confirmPhrase()"
      />
    </div>
  `,
})
export class BackupRestoreComponent {
  private readonly http = inject(HttpClient);
  private readonly bucketsApi = inject(BucketsAdminService);
  private readonly confirmDialog = viewChild.required(ConfirmDialogComponent);

  readonly buckets = signal<string[]>([]);
  readonly selectedBucket = signal('');
  readonly busy = signal(false);

  readonly confirmTitle = signal('');
  readonly confirmDesc = signal('');
  readonly confirmPhrase = signal<string | null>(null);

  constructor() {
    void this.loadBuckets();
  }

  private async loadBuckets(): Promise<void> {
    try {
      const res = await firstValueFrom(this.bucketsApi.listBuckets());
      this.buckets.set((res?.buckets ?? []).map((b) => b.name));
    } catch {
      /* leave empty; the selector just shows nothing */
    }
  }

  // ---- backup (download) ----------------------------------------------
  async downloadBucketBackup(): Promise<void> {
    const name = this.selectedBucket();
    if (!name) return;
    await this.download(`/api/admin/buckets/${encodeURIComponent(name)}/backup`, `openbucket-${name}-backup.zip`);
  }

  async downloadInstanceBackup(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 10);
    await this.download('/api/admin/backup', `openbucket-instance-backup-${stamp}.zip`);
  }

  private async download(url: string, filename: string): Promise<void> {
    this.busy.set(true);
    try {
      const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
      notify.success('Backup downloaded');
    } catch {
      notify.error('Backup download failed');
    } finally {
      this.busy.set(false);
    }
  }

  // ---- restore (upload, reset) ----------------------------------------
  async onBucketRestore(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    const name = this.selectedBucket();
    this.confirmTitle.set(`Restore bucket "${name}"?`);
    this.confirmDesc.set(
      `This ERASES all current objects in "${name}" and replaces them with the contents of the backup. This cannot be undone.`,
    );
    this.confirmPhrase.set(name);
    if (!(await this.confirmDialog().confirm())) return;
    await this.restore(`/api/admin/buckets/${encodeURIComponent(name)}/restore`, file, `Bucket "${name}" restored`);
  }

  async onInstanceRestore(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.confirmTitle.set('Restore the entire instance?');
    this.confirmDesc.set(
      'This ERASES ALL buckets and objects and rebuilds the instance from the backup. This cannot be undone.',
    );
    this.confirmPhrase.set('RESET');
    if (!(await this.confirmDialog().confirm())) return;
    await this.restore('/api/admin/restore', file, 'Instance restored', true);
  }

  private async restore(url: string, file: File, successMsg: string, reload = false): Promise<void> {
    this.busy.set(true);
    const req = firstValueFrom(this.http.post<unknown>(url, file));
    // Toasts for the in-flight request; control flow uses the same promise below.
    notify.promise(req, { loading: 'Restoring… this may take a while', success: successMsg, error: 'Restore failed' });
    try {
      await req;
      if (reload) setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      const msg = err instanceof HttpErrorResponse ? (err.error?.message as string | undefined) : undefined;
      if (msg) notify.error(msg);
    } finally {
      this.busy.set(false);
    }
  }
}
