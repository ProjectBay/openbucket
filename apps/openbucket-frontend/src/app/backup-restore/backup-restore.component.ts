import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideUpload, lucideDatabase, lucideServer, lucideCalendarClock, lucidePlay } from '@ng-icons/lucide';

import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';

import { BucketsAdminService, BackupScheduleService, ScheduleStatusDto } from '@openbucket/api-client';
import { notify } from '../shared/ui/notify';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
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
  imports: [FormsModule, TranslateModule, NgIcon, HlmCardImports, HlmButton, RelativeTimePipe, ConfirmDialogComponent],
  providers: [provideIcons({ lucideDownload, lucideUpload, lucideDatabase, lucideServer, lucideCalendarClock, lucidePlay })],
  template: `
    <div class="space-y-6 p-6">
      <!-- Scheduled backups -->
      <section hlmCard>
        <div hlmCardHeader>
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 hlmCardTitle class="flex items-center gap-2">
                <ng-icon name="lucideCalendarClock" size="18" /> {{ 'backupRestore.schedule.title' | translate }}
              </h3>
              <p hlmCardDescription>{{ 'backupRestore.schedule.description' | translate }}</p>
            </div>
            @if (schedule(); as s) {
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                [class]="s.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
              >
                {{ (s.enabled ? 'backupRestore.schedule.enabled' : 'backupRestore.schedule.disabled') | translate }}
              </span>
            }
          </div>
        </div>
        <div hlmCardContent class="space-y-4">
          @if (schedule(); as s) {
            @if (s.enabled) {
              <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt class="text-muted-foreground text-xs">{{ 'backupRestore.schedule.scope' | translate }}</dt>
                  <dd>
                    {{ (s.scope === 'instance' ? 'backupRestore.schedule.scopeInstance' : 'backupRestore.schedule.scopeBuckets') | translate }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ 'backupRestore.schedule.scheduleLabel' | translate }}</dt>
                  <dd>
                    @if (s.schedule.cron) {
                      <code class="text-xs">{{ s.schedule.cron }}</code>
                    } @else {
                      {{ 'backupRestore.schedule.every' | translate: { minutes: s.schedule.intervalMinutes } }}
                    }
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ 'backupRestore.schedule.retention' | translate }}</dt>
                  <dd>{{ 'backupRestore.schedule.retentionValue' | translate: { keepLast: s.keepLast, maxAgeDays: s.maxAgeDays } }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ 'backupRestore.schedule.lastRun' | translate }}</dt>
                  <dd class="flex items-center gap-1.5">
                    @if (s.lastRunAt) {
                      <span>{{ s.lastRunAt | relativeTime }}</span>
                      <span
                        class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                        [class]="statusBadgeClass(s.lastStatus)"
                      >
                        {{ statusLabel(s.lastStatus) | translate }}
                      </span>
                    } @else {
                      {{ 'backupRestore.schedule.never' | translate }}
                    }
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ 'backupRestore.schedule.nextRun' | translate }}</dt>
                  <dd>{{ s.nextRunAt ? (s.nextRunAt | relativeTime) : ('backupRestore.schedule.never' | translate) }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ 'backupRestore.schedule.snapshots' | translate }}</dt>
                  <dd>{{ s.snapshotCount }}</dd>
                </div>
              </dl>
              @if (s.lastError) {
                <p class="text-destructive text-xs">{{ s.lastError }}</p>
              }
              <div class="flex flex-wrap gap-2">
                <button hlmBtn size="sm" [disabled]="busy() || scheduleBusy()" (click)="runNow()">
                  <ng-icon name="lucidePlay" size="16" class="mr-1.5" />
                  {{ (scheduleBusy() ? 'backupRestore.schedule.running' : 'backupRestore.schedule.runNow') | translate }}
                </button>
              </div>
            } @else {
              <p class="text-muted-foreground text-sm">{{ 'backupRestore.schedule.offHint' | translate }}</p>
            }
          }
        </div>
      </section>

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
  private readonly scheduleApi = inject(BackupScheduleService);
  private readonly confirmDialog = viewChild.required(ConfirmDialogComponent);

  readonly buckets = signal<string[]>([]);
  readonly selectedBucket = signal('');
  readonly busy = signal(false);

  /** Scheduled-backup status (STORY-1203). Null until first load / when the
   *  endpoint fails; the card just stays hidden. */
  readonly schedule = signal<ScheduleStatusDto | null>(null);
  readonly scheduleBusy = signal(false);

  readonly confirmTitle = signal('');
  readonly confirmDesc = signal('');
  readonly confirmPhrase = signal<string | null>(null);

  constructor() {
    void this.loadBuckets();
    void this.loadSchedule();
  }

  private async loadBuckets(): Promise<void> {
    try {
      const res = await firstValueFrom(this.bucketsApi.listBuckets());
      this.buckets.set((res?.buckets ?? []).map((b) => b.name));
    } catch {
      /* leave empty; the selector just shows nothing */
    }
  }

  // ---- scheduled backups ----------------------------------------------
  private async loadSchedule(): Promise<void> {
    try {
      this.schedule.set(await firstValueFrom(this.scheduleApi.getBackupSchedule()));
    } catch {
      this.schedule.set(null); // hide the card when the status can't be read
    }
  }

  /** i18n key for a run status badge. */
  statusLabel(status: ScheduleStatusDto['lastStatus']): string {
    return `backupRestore.schedule.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  }

  /** Tailwind colour classes for a run status badge (ok/error/skipped). */
  statusBadgeClass(status: ScheduleStatusDto['lastStatus']): string {
    if (status === 'ok') return 'bg-primary/10 text-primary';
    if (status === 'error') return 'bg-destructive/10 text-destructive';
    return 'bg-muted text-muted-foreground';
  }

  async runNow(): Promise<void> {
    this.scheduleBusy.set(true);
    try {
      const res = await firstValueFrom(this.scheduleApi.runBackupNow());
      notify.success(res?.started ? 'Backup started' : 'A backup is already running');
      // Reflect the new lastRunAt once the snapshot has had a moment to complete.
      setTimeout(() => void this.loadSchedule(), 2000);
    } catch {
      notify.error('Could not start backup');
    } finally {
      this.scheduleBusy.set(false);
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
