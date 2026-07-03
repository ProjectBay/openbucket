import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { HlmCardImports } from '@openbucket/spartan-ui/card';
import { HlmButton } from '@openbucket/spartan-ui/button';
import { HlmSwitch } from '@openbucket/spartan-ui/switch';

import {
  AppearanceStore,
  type ColorScheme,
  type ContentMaxWidth,
  type ShellVariant,
  type TabsVariant,
  type Theme,
} from '../core/platform/common/appearance/store/appearance.store';
import { type LocaleCode } from '../core/platform/common/locale/store/locale.store';
import { PageHeaderService } from '../layout/shell/services';
import { ChangePasswordComponent } from './change-password.component';

/**
 * Settings screen (STORY-0607): exposes the appearance engine — 12 color schemes,
 * light/dark/system, shell layout, language, reduced motion — plus change-password.
 * Everything is wired to the AppearanceStore (persisted to this browser).
 */
@Component({
  selector: 'ob-settings',
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    HlmCardImports,
    HlmButton,
    HlmSwitch,
    HlmSelectImports,
    BrnSelectImports,
    ChangePasswordComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6 p-6">
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
            <span class="text-sm font-medium">{{ 'settings.shellLayout' | translate }}</span>
            <div class="flex gap-2">
              @for (sh of shells; track sh.value) {
                <button
                  hlmBtn
                  size="sm"
                  [variant]="store.shellVariant() === sh.value ? 'default' : 'outline'"
                  (click)="store.setShellVariant(sh.value)"
                >
                  {{ sh.label | translate }}
                </button>
              }
            </div>
          </div>

          <div class="space-y-2">
            <span class="text-sm font-medium">{{ 'settings.tabsMode' | translate }}</span>
            <div class="flex gap-2">
              @for (tv of tabsModes; track tv.value) {
                <button
                  hlmBtn
                  size="sm"
                  [variant]="store.tabsVariant() === tv.value ? 'default' : 'outline'"
                  (click)="store.setTabsVariant(tv.value)"
                >
                  {{ tv.label | translate }}
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
  `,
})
export class SettingsComponent {
  protected readonly store = inject(AppearanceStore);
  private readonly pageHeader = inject(PageHeaderService);

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
  protected readonly shells: { value: ShellVariant; label: string }[] = [
    { value: 'inset', label: 'settings.shellInset' },
    { value: 'sticky', label: 'settings.shellSticky' },
    { value: 'compact', label: 'settings.shellCompact' },
  ];
  protected readonly tabsModes: { value: TabsVariant; label: string }[] = [
    { value: 'default', label: 'settings.tabsDefault' },
    { value: 'line', label: 'settings.tabsLine' },
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
    this.pageHeader.setPageHeader('settings.title', 'settings.subtitle');
    this.pageHeader.hideActionButton();
  }
}
