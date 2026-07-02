import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArchive,
  lucideDatabase,
  lucideKey,
  lucideLayoutDashboard,
  lucidePlus,
  lucideSettings,
  lucideSun,
} from '@ng-icons/lucide';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmDialog, HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { HlmCommandImports } from '@openbucket/spartan-ui/command';
import { HlmKbd } from '@openbucket/spartan-ui/kbd';

import { BucketsSignalStore } from '../../buckets/buckets.signal-store';
import { AppearanceStore } from '../../core/platform/common/appearance/store/appearance.store';
import { CommandPaletteService } from './command-palette.service';

/**
 * ⌘K command palette (STORY-0610): a spartan command inside a dialog, opened by
 * ⌘K/Ctrl-K or the brand mark. Groups static nav, the live bucket list, and
 * actions; typing filters across all groups. Also wires `g b` / `g k` go-to
 * shortcuts. Mounted once in the shell.
 */
@Component({
  selector: 'ob-command-palette',
  standalone: true,
  imports: [TranslateModule, NgIcon, BrnDialogImports, HlmDialogImports, HlmCommandImports, HlmKbd],
  providers: [
    provideIcons({
      lucideArchive,
      lucideDatabase,
      lucideKey,
      lucideLayoutDashboard,
      lucidePlus,
      lucideSettings,
      lucideSun,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog>
      <hlm-dialog-content
        *brnDialogContent="let ctx"
        class="overflow-hidden p-0"
      >
        <hlm-command hlmCommandDialog>
          <hlm-command-search>
            <input
              hlmCommandSearchInput
              [placeholder]="'command.placeholder' | translate"
            />
          </hlm-command-search>
          <div hlmCommandList>
            <div hlmCommandEmpty>{{ 'command.noResults' | translate }}</div>

            <hlm-command-group>
              <span hlmCommandGroupLabel>{{ 'command.goTo' | translate }}</span>
              @for (n of nav; track n.url) {
                <button
                  hlmCommandItem
                  [value]="n.label | translate"
                  (selected)="go(n.url)"
                >
                  <ng-icon [name]="n.icon" />
                  {{ n.label | translate }}
                </button>
              }
            </hlm-command-group>

            @if (buckets().length) {
              <hlm-command-group>
                <span hlmCommandGroupLabel>{{ 'sidebar.storage.buckets' | translate }}</span>
                @for (b of buckets(); track b.name) {
                  <button
                    hlmCommandItem
                    [value]="b.name"
                    (selected)="go('/buckets/' + b.name + '/browse')"
                  >
                    <ng-icon name="lucideDatabase" />
                    {{ b.name }}
                  </button>
                }
              </hlm-command-group>
            }

            <hlm-command-group>
              <span hlmCommandGroupLabel>{{ 'command.actions' | translate }}</span>
              <button
                hlmCommandItem
                [value]="'dashboard.createBucket' | translate"
                (selected)="go('/buckets')"
              >
                <ng-icon name="lucidePlus" />
                {{ 'dashboard.createBucket' | translate }}
              </button>
              <button
                hlmCommandItem
                [value]="'dashboard.createKey' | translate"
                (selected)="go('/keys')"
              >
                <ng-icon name="lucideKey" />
                {{ 'dashboard.createKey' | translate }}
              </button>
              <button
                hlmCommandItem
                [value]="'command.toggleTheme' | translate"
                (selected)="toggleTheme()"
              >
                <ng-icon name="lucideSun" />
                {{ 'command.toggleTheme' | translate }}
              </button>
            </hlm-command-group>
          </div>

          <div
            class="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-xs"
          >
            <span class="flex items-center gap-1">
              <kbd hlmKbd>g</kbd>
              <kbd hlmKbd>b</kbd>
              {{ 'sidebar.storage.buckets' | translate }}
            </span>
            <span class="flex items-center gap-1">
              <kbd hlmKbd>g</kbd>
              <kbd hlmKbd>k</kbd>
              {{ 'sidebar.storage.keys' | translate }}
            </span>
          </div>
        </hlm-command>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class CommandPaletteComponent {
  private readonly router = inject(Router);
  private readonly store = inject(BucketsSignalStore);
  private readonly appearance = inject(AppearanceStore);
  private readonly paletteService = inject(CommandPaletteService);
  private readonly dialog = viewChild.required(HlmDialog);

  private pendingG = false;
  private gTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly buckets = computed(() => this.store.items());
  protected readonly nav = [
    { label: 'sidebar.storage.dashboard', icon: 'lucideLayoutDashboard', url: '/' },
    { label: 'sidebar.storage.buckets', icon: 'lucideDatabase', url: '/buckets' },
    { label: 'sidebar.storage.keys', icon: 'lucideKey', url: '/keys' },
    { label: 'sidebar.storage.settings', icon: 'lucideSettings', url: '/settings' },
    { label: 'sidebar.admin.backupRestore', icon: 'lucideArchive', url: '/backup-restore' },
  ];

  constructor() {
    this.paletteService.register(() => this.open());
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.open();
      return;
    }

    // Single-key "g then b/k" go-to shortcuts (ignored while typing).
    const target = e.target;
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (e.key === 'g') {
      this.pendingG = true;
      clearTimeout(this.gTimer);
      this.gTimer = setTimeout(() => (this.pendingG = false), 600);
      return;
    }
    if (this.pendingG) {
      this.pendingG = false;
      if (e.key === 'b') {
        e.preventDefault();
        void this.router.navigate(['/buckets']);
      } else if (e.key === 'k') {
        e.preventDefault();
        void this.router.navigate(['/keys']);
      }
    }
  }

  open(): void {
    void this.store.refresh();
    this.dialog().open();
  }

  protected go(url: string): void {
    this.dialog().close();
    void this.router.navigate([url]);
  }

  protected toggleTheme(): void {
    this.appearance.setTheme(this.appearance.effectiveTheme() === 'dark' ? 'light' : 'dark');
    this.dialog().close();
  }
}
