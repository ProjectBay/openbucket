import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';

import {
  AppearanceStore,
  type ColorScheme,
  type ContentMaxWidth,
  type Theme,
} from '../core/platform/common/appearance/store/appearance.store';
import { type LocaleCode } from '../core/platform/common/locale/store/locale.store';
import { PageHeaderService } from '../layout/shell/services';
import {
  PageLayoutComponent,
  type PageTab,
} from '../layout/components/page-layout/page-layout.component';
import { AuthService } from '../auth/auth.service';
import { ChangePasswordComponent } from './change-password.component';
import { KeysListComponent } from '../keys/keys-list.component';
import { AdminUsersListComponent } from '../users/admin-users-list.component';
import { BackupRestoreComponent } from '../backup-restore/backup-restore.component';
import { ReplicationComponent } from '../replication/replication.component';
import { AuditLogComponent } from '../audit/audit-log.component';

/**
 * Settings screen (STORY-0607): a single tabbed page (mirrors the bucket-detail
 * tab pattern) that consolidates every instance-level admin area. Tabs, in order:
 * Appearance (the appearance engine + change-password), Access Keys, Admin Users
 * (full-admin only, EPIC-11), Backup & Restore, Replication, Audit Log. The page
 * header is set once here; the embedded feature components no longer own it. The
 * active tab is driven by the `?tab=` query param (defaulting to `appearance`).
 */
@Component({
  selector: 'ob-settings',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    PageLayoutComponent,
    HlmCardImports,
    HlmButton,
    HlmSwitch,
    HlmSelectImports,
    BrnSelectImports,
    ChangePasswordComponent,
    KeysListComponent,
    AdminUsersListComponent,
    BackupRestoreComponent,
    ReplicationComponent,
    AuditLogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ob-page-layout
      [tabs]="tabs()"
      [activeTab]="activeTab()"
      (tabChange)="onTab($event)"
    >
      @switch (activeTab()) {
        @case ('appearance') {
          <div class="space-y-6">
            <div hlmCard>
              <div hlmCardHeader>
                <h3 hlmCardTitle>{{ 'settings.appearance' | translate }}</h3>
                <p hlmCardDescription>{{ 'settings.appearanceHint' | translate }}</p>
              </div>
              <div
                hlmCardContent
                class="space-y-6"
              >
                <div class="space-y-2">
                  <span class="text-sm font-medium">{{ 'settings.colorScheme' | translate }}</span>
                  <div class="flex flex-wrap gap-2">
                    @for (s of schemes; track s.value) {
                      <button
                        type="button"
                        class="ring-offset-background size-8 rounded-full border transition-transform hover:scale-110"
                        [style.background-color]="s.color"
                        [class.ring-2]="store.colorScheme() === s.value"
                        [class.ring-ring]="store.colorScheme() === s.value"
                        [class.ring-offset-2]="store.colorScheme() === s.value"
                        [attr.aria-label]="s.label"
                        [attr.aria-pressed]="store.colorScheme() === s.value"
                        (click)="store.setColorScheme(s.value)"
                      ></button>
                    }
                  </div>
                </div>

                <div class="space-y-2">
                  <span class="text-sm font-medium">{{ 'settings.mode' | translate }}</span>
                  <div class="flex gap-2">
                    @for (t of themes; track t.value) {
                      <button
                        hlmBtn
                        size="sm"
                        [variant]="store.theme() === t.value ? 'default' : 'outline'"
                        (click)="store.setTheme(t.value)"
                      >
                        {{ t.label | translate }}
                      </button>
                    }
                  </div>
                </div>

                <div class="space-y-2">
                  <span class="text-sm font-medium">{{ 'settings.contentWidth' | translate }}</span>
                  <div class="flex flex-wrap gap-2">
                    @for (cw of contentWidths; track cw.value) {
                      <button
                        hlmBtn
                        size="sm"
                        [variant]="store.contentMaxWidth() === cw.value ? 'default' : 'outline'"
                        (click)="store.setContentMaxWidth(cw.value)"
                      >
                        {{ cw.label | translate }}
                      </button>
                    }
                  </div>
                </div>

                <div class="space-y-2">
                  <span class="text-sm font-medium">{{ 'settings.language' | translate }}</span>
                  <brn-select
                    hlm
                    [ngModel]="store.locale()"
                    (ngModelChange)="store.setLocale($event)"
                  >
                    <hlm-select-trigger class="w-48">
                      <hlm-select-value />
                    </hlm-select-trigger>
                    <hlm-select-content>
                      @for (l of locales; track l.value) {
                        <hlm-option [value]="l.value">{{ l.label }}</hlm-option>
                      }
                    </hlm-select-content>
                  </brn-select>
                </div>

                <div class="flex items-center justify-between gap-2">
                  <div>
                    <span class="text-sm font-medium">{{ 'settings.reducedMotion' | translate }}</span>
                    <p class="text-muted-foreground text-xs">
                      {{ 'settings.reducedMotionHint' | translate }}
                    </p>
                  </div>
                  <hlm-switch
                    [attr.aria-label]="'settings.reducedMotion' | translate"
                    [checked]="store.reducedMotion()"
                    (checkedChange)="store.setReducedMotion($event)"
                  />
                </div>

                <div>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    (click)="store.reset()"
                  >
                    {{ 'settings.reset' | translate }}
                  </button>
                </div>
              </div>
            </div>

            <ob-change-password />
          </div>
        }

        @case ('keys') {
          <ob-keys-list />
        }

        @case ('users') {
          <ob-admin-users-list />
        }

        @case ('backup-restore') {
          <ob-backup-restore />
        }

        @case ('replication') {
          <ob-replication />
        }

        @case ('audit') {
          <ob-audit-log />
        }
      }
    </ob-page-layout>
  `,
})
export class SettingsComponent implements OnInit {
  protected readonly store = inject(AppearanceStore);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeTab = signal('appearance');

  /** Tabs (EPIC-11): the Admin Users tab is dropped for read-only admins. */
  protected readonly tabs = computed<PageTab[]>(() => {
    const base: PageTab[] = [
      { id: 'appearance', label: 'settings.appearance' },
      { id: 'keys', label: 'sidebar.storage.keys' },
      { id: 'users', label: 'sidebar.admin.users' },
      { id: 'backup-restore', label: 'backupRestore.title' },
      { id: 'replication', label: 'replication.title' },
      { id: 'audit', label: 'sidebar.admin.audit' },
    ];
    return this.auth.isFullAdmin() ? base : base.filter((t) => t.id !== 'users');
  });

  protected readonly schemes: { value: ColorScheme; label: string; color: string }[] = [
    { value: 'slate', label: 'Slate', color: '#475569' },
    { value: 'gray', label: 'Gray', color: '#4b5563' },
    { value: 'zinc', label: 'Zinc', color: '#52525b' },
    { value: 'neutral', label: 'Neutral', color: '#525252' },
    { value: 'stone', label: 'Stone', color: '#57534e' },
    { value: 'violet', label: 'Violet', color: '#7c3aed' },
    { value: 'blue', label: 'Blue', color: '#2563eb' },
    { value: 'green', label: 'Green', color: '#16a34a' },
    { value: 'orange', label: 'Orange', color: '#ea580c' },
    { value: 'red', label: 'Red', color: '#dc2626' },
    { value: 'rose', label: 'Rose', color: '#e11d48' },
    { value: 'yellow', label: 'Yellow', color: '#ca8a04' },
  ];
  protected readonly themes: { value: Theme; label: string }[] = [
    { value: 'light', label: 'settings.modeLight' },
    { value: 'dark', label: 'settings.modeDark' },
    { value: 'system', label: 'settings.modeSystem' },
  ];
  protected readonly contentWidths: { value: ContentMaxWidth; label: string }[] = [
    { value: 'full', label: 'settings.widthFull' },
    { value: '5xl', label: 'settings.widthExtraWide' },
    { value: '4xl', label: 'settings.widthWide' },
    { value: '3xl', label: 'settings.widthMedium' },
    { value: '2xl', label: 'settings.widthNarrow' },
  ];
  protected readonly locales: { value: LocaleCode; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
  ];

  constructor() {
    // The tabs carry the sections — set the page header once, no action button.
    this.pageHeader.setPageHeader('settings.title', 'settings.subtitle');
    this.pageHeader.hideActionButton();
  }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const requested = q.get('tab') ?? 'appearance';
      // Fall back to the default when the tab is unknown or gated (e.g. a
      // read-only admin deep-linking `?tab=users`).
      const allowed = this.tabs().some((t) => t.id === requested);
      this.activeTab.set(allowed ? requested : 'appearance');
    });
  }

  onTab(tab: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }
}
