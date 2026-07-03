import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';
import { HlmBadge } from '@openbucket/spartan-ui/badge';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmInput } from '@openbucket/spartan-ui/input';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import {
  BucketSummaryDto,
  BucketsAdminService,
  EncryptionConfigDtoAlgorithmEnum,
  ObjectLockConfigDto,
  ObjectLockConfigDtoModeEnum,
  VersioningConfigDtoStatusEnum,
} from '@openbucket/api-client';

import { BucketLifecycleEditorComponent } from './bucket-lifecycle-editor.component';
import { BucketCorsEditorComponent } from './bucket-cors-editor.component';
import { BucketPolicyEditorComponent } from './bucket-policy-editor.component';
import { ObjectBrowserComponent } from '../objects/object-browser.component';
import { RelativeTimePipe } from '../shared/ui/relative-time.pipe';
import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { notify } from '../shared/ui/notify';
import { PageHeaderService } from '../layout/shell/services';
import { PageLayoutComponent, type PageTab } from '../layout/components/page-layout/page-layout.component';

/**
 * Bucket-detail tabbed page (STORY-0613): manages bucket-level S3 config over the
 * admin endpoints (STORY-0612). Tabs: Objects, Properties, Versioning, Encryption,
 * Object Lock (enable + default retention), Tags (key/value), and visual builders
 * for Lifecycle / CORS / Policy.
 */
@Component({
  selector: 'ob-bucket-detail',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    NgIcon,
    PageLayoutComponent,
    HlmButton,
    HlmSwitch,
    HlmBadge,
    HlmCardImports,
    HlmInput,
    HlmSelectImports,
    BrnSelectImports,
    RelativeTimePipe,
    ByteSizePipe,
    BucketLifecycleEditorComponent,
    BucketCorsEditorComponent,
    BucketPolicyEditorComponent,
    ObjectBrowserComponent,
  ],
  providers: [provideIcons({ lucidePlus, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ob-page-layout
      [tabs]="tabs"
      [activeTab]="activeTab()"
      (tabChange)="onTab($event)"
    >
      @switch (activeTab()) {
        @case ('objects') {
          <ob-object-browser [padded]="false" />
        }

        @case ('properties') {
          @if (summary(); as s) {
            <div hlmCard>
              <div hlmCardContent class="space-y-2 pt-6 text-sm">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Created</span><span>{{ s.createdAt | relativeTime }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Objects</span><span class="tabular-nums">{{ s.objectCount }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Size</span><span class="tabular-nums">{{ s.sizeBytes | byteSize }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Versioning</span>
                  <span hlmBadge [variant]="s.versioning === 'enabled' ? 'default' : 'secondary'">{{ s.versioning }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Object lock</span>
                  <span hlmBadge [variant]="s.objectLock ? 'default' : 'secondary'">{{ s.objectLock ? 'enabled' : 'disabled' }}</span>
                </div>
              </div>
            </div>
          }
        }

        @case ('versioning') {
          <div hlmCard>
            <div hlmCardContent class="flex items-center justify-between gap-4 pt-6">
              <div>
                <p class="font-medium">Versioning</p>
                <p class="text-muted-foreground text-sm">Once enabled it can be suspended, not removed.</p>
              </div>
              <hlm-switch
                aria-label="Versioning"
                [checked]="summary()?.versioning === 'enabled'"
                (checkedChange)="toggleVersioning($event)"
              />
            </div>
          </div>
        }

        @case ('encryption') {
          <div hlmCard>
            <div hlmCardContent class="flex items-center justify-between gap-4 pt-6">
              <div>
                <p class="font-medium">Default encryption (SSE-S3)</p>
                <p class="text-muted-foreground text-sm">Encrypt new objects at rest with AES-256.</p>
              </div>
              <hlm-switch
                aria-label="Default encryption"
                [checked]="encryptionEnabled()"
                (checkedChange)="toggleEncryption($event)"
              />
            </div>
          </div>
        }

        @case ('objectLock') {
          <div hlmCard>
            <div hlmCardContent class="space-y-4 pt-6">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="font-medium">Object Lock (WORM)</p>
                  <p class="text-muted-foreground text-sm">
                    Protect objects from being overwritten or deleted. Best used with versioning enabled.
                  </p>
                </div>
                <hlm-switch
                  aria-label="Object lock"
                  [checked]="objectLockEnabled()"
                  (checkedChange)="objectLockEnabled.set($event)"
                />
              </div>

              @if (objectLockEnabled()) {
                <div class="space-y-1.5">
                  <span class="text-sm font-medium">Default retention mode</span>
                  <brn-select hlm [ngModel]="objectLockMode()" (ngModelChange)="objectLockMode.set($event)">
                    <hlm-select-trigger class="w-full">
                      <hlm-select-value />
                    </hlm-select-trigger>
                    <hlm-select-content>
                      @for (m of objectLockModes; track m.value) {
                        <hlm-option [value]="m.value">{{ m.label }}</hlm-option>
                      }
                    </hlm-select-content>
                  </brn-select>
                  <p class="text-muted-foreground text-xs">
                    Governance can be bypassed with a privileged override; Compliance cannot be removed until it expires.
                  </p>
                </div>

                @if (objectLockMode() !== Mode.Off) {
                  <label class="block space-y-1.5">
                    <span class="text-sm font-medium">Default retention (days)</span>
                    <input
                      hlmInput
                      type="number"
                      min="1"
                      class="w-full"
                      placeholder="e.g. 30"
                      [ngModel]="objectLockDays()"
                      (ngModelChange)="objectLockDays.set($event)"
                    />
                  </label>
                }
              }

              <div class="flex justify-end">
                <button hlmBtn size="sm" [disabled]="objectLockSaving()" (click)="saveObjectLock()">Save</button>
              </div>
            </div>
          </div>
        }

        @case ('tags') {
          <div hlmCard>
            <div hlmCardContent class="space-y-2 pt-6">
              @for (t of tagRows(); track $index) {
                <div class="flex items-center gap-2">
                  <input hlmInput class="flex-1" placeholder="key" [ngModel]="t.key" (ngModelChange)="setTag($index, 'key', $event)" />
                  <input hlmInput class="flex-1" placeholder="value" [ngModel]="t.value" (ngModelChange)="setTag($index, 'value', $event)" />
                  <button hlmBtn variant="ghost" size="icon-sm" aria-label="Remove tag" (click)="removeTag($index)">
                    <ng-icon name="lucideTrash2" class="text-base" />
                  </button>
                </div>
              } @empty {
                <p class="text-muted-foreground text-sm">No tags.</p>
              }
              <div class="flex gap-2 pt-1">
                <button hlmBtn variant="outline" size="sm" (click)="addTag()"><ng-icon name="lucidePlus" class="text-base" />Add tag</button>
                <button hlmBtn size="sm" (click)="saveTags()">Save tags</button>
              </div>
            </div>
          </div>
        }

        @case ('lifecycle') {
          <ob-bucket-lifecycle-editor [bucket]="name()" />
        }

        @case ('cors') {
          <ob-bucket-cors-editor [bucket]="name()" />
        }

        @case ('policy') {
          <ob-bucket-policy-editor [bucket]="name()" />
        }
      }
    </ob-page-layout>
  `,
})
export class BucketDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(BucketsAdminService);
  private readonly pageHeader = inject(PageHeaderService);

  readonly name = signal('');
  readonly activeTab = signal('objects');

  protected readonly tabs: PageTab[] = [
    { id: 'objects', label: 'bucketDetail.tabs.objects' },
    { id: 'properties', label: 'bucketDetail.tabs.properties' },
    { id: 'versioning', label: 'bucketDetail.tabs.versioning' },
    { id: 'encryption', label: 'bucketDetail.tabs.encryption' },
    { id: 'objectLock', label: 'bucketDetail.tabs.objectLock' },
    { id: 'tags', label: 'bucketDetail.tabs.tags' },
    { id: 'lifecycle', label: 'bucketDetail.tabs.lifecycle' },
    { id: 'cors', label: 'bucketDetail.tabs.cors' },
    { id: 'policy', label: 'bucketDetail.tabs.policy' },
  ];
  readonly summary = signal<BucketSummaryDto | null>(null);
  readonly encryptionEnabled = signal(false);
  readonly tagRows = signal<{ key: string; value: string }[]>([]);

  readonly objectLockEnabled = signal(false);
  readonly objectLockMode = signal<ObjectLockConfigDtoModeEnum>(ObjectLockConfigDtoModeEnum.Off);
  readonly objectLockDays = signal<number | null>(null);
  readonly objectLockSaving = signal(false);

  /** Template handles: the mode enum + its selectable options. */
  protected readonly Mode = ObjectLockConfigDtoModeEnum;
  protected readonly objectLockModes = [
    { value: ObjectLockConfigDtoModeEnum.Off, label: 'None' },
    { value: ObjectLockConfigDtoModeEnum.Governance, label: 'Governance' },
    { value: ObjectLockConfigDtoModeEnum.Compliance, label: 'Compliance' },
  ];

  /** Tabs whose config has already been fetched (lazy-load once per tab). */
  private readonly loadedTabs = new Set<string>();

  ngOnInit(): void {
    this.name.set(this.route.snapshot.paramMap.get('name') ?? '');
    this.pageHeader.setPageHeader(this.name());
    // hasTabs is managed by <ob-page-layout>.
    void this.loadSummary();
    // Lazy-load each tab's config only when it becomes active, so unconfigured
    // features aren't all probed (and 404'd) on every page open.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const tab = q.get('tab') ?? 'objects';
      this.activeTab.set(tab);
      this.loadTab(tab);
    });
  }

  private loadTab(tab: string): void {
    if (this.loadedTabs.has(tab)) return;
    this.loadedTabs.add(tab);
    switch (tab) {
      case 'encryption':
        void this.loadEncryption();
        break;
      case 'tags':
        void this.loadTags();
        break;
      case 'objectLock':
        void this.loadObjectLock();
        break;
      // properties/versioning use the summary; lifecycle/cors/policy self-load
      // inside their own editor components when their tab becomes active.
    }
  }

  onTab(tab: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }

  private async loadSummary(): Promise<void> {
    try {
      this.summary.set((await firstValueFrom(this.api.getBucket(this.name()))) ?? null);
    } catch {
      /* surfaced elsewhere */
    }
  }

  private async loadEncryption(): Promise<void> {
    try {
      await firstValueFrom(this.api.getBucketEncryption(this.name()));
      this.encryptionEnabled.set(true);
    } catch {
      this.encryptionEnabled.set(false);
    }
  }

  private async loadTags(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.getBucketTagging(this.name()));
      this.tagRows.set(Object.entries(res.tags ?? {}).map(([key, value]) => ({ key, value })));
    } catch {
      this.tagRows.set([]);
    }
  }

  private async loadObjectLock(): Promise<void> {
    try {
      const cfg = await firstValueFrom(this.api.getBucketObjectLock(this.name()));
      this.objectLockEnabled.set(cfg.enabled);
      this.objectLockMode.set(cfg.mode ?? ObjectLockConfigDtoModeEnum.Off);
      this.objectLockDays.set(cfg.defaultRetentionDays ?? null);
    } catch {
      // 404 — object lock was never enabled on this bucket.
      this.objectLockEnabled.set(false);
      this.objectLockMode.set(ObjectLockConfigDtoModeEnum.Off);
      this.objectLockDays.set(null);
    }
  }

  async saveObjectLock(): Promise<void> {
    const enabled = this.objectLockEnabled();
    const mode = this.objectLockMode();
    const days = this.objectLockDays();
    const dto: ObjectLockConfigDto = { enabled };
    if (enabled) {
      dto.mode = mode;
      if (mode !== ObjectLockConfigDtoModeEnum.Off && days != null && days > 0) {
        dto.defaultRetentionDays = days;
      }
    }
    this.objectLockSaving.set(true);
    try {
      await firstValueFrom(this.api.putBucketObjectLock(this.name(), dto));
      notify.success('Object lock updated');
      await this.loadSummary();
    } catch {
      notify.error('Failed to update object lock');
    } finally {
      this.objectLockSaving.set(false);
    }
  }

  async toggleVersioning(enabled: boolean): Promise<void> {
    try {
      await firstValueFrom(
        this.api.putBucketVersioning(this.name(), {
          status: enabled
            ? VersioningConfigDtoStatusEnum.Enabled
            : VersioningConfigDtoStatusEnum.Suspended,
        }),
      );
      notify.success('Versioning updated');
      await this.loadSummary();
    } catch {
      notify.error('Failed to update versioning');
    }
  }

  async toggleEncryption(enabled: boolean): Promise<void> {
    try {
      if (enabled) {
        await firstValueFrom(
          this.api.putBucketEncryption(this.name(), {
            algorithm: EncryptionConfigDtoAlgorithmEnum.Aes256,
          }),
        );
      } else {
        await firstValueFrom(this.api.deleteBucketEncryption(this.name()));
      }
      notify.success('Encryption updated');
      this.encryptionEnabled.set(enabled);
    } catch {
      notify.error('Failed to update encryption');
    }
  }

  addTag(): void {
    this.tagRows.update((rows) => [...rows, { key: '', value: '' }]);
  }

  removeTag(index: number): void {
    this.tagRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  setTag(index: number, field: 'key' | 'value', value: string): void {
    this.tagRows.update((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  async saveTags(): Promise<void> {
    const tags: Record<string, string> = {};
    for (const r of this.tagRows()) {
      const k = r.key.trim();
      if (k) tags[k] = r.value;
    }
    try {
      if (Object.keys(tags).length === 0) {
        await firstValueFrom(this.api.deleteBucketTagging(this.name()));
      } else {
        await firstValueFrom(this.api.putBucketTagging(this.name(), { tags }));
      }
      notify.success('Tags saved');
    } catch {
      notify.error('Failed to save tags');
    }
  }

}
