import { Injectable, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppearanceStore } from '../store/appearance.store';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly appearanceStore = inject(AppearanceStore);
  private readonly platformId = inject(PLATFORM_ID);
  private mediaQueryList?: MediaQueryList;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQueryList.addEventListener('change', () => this.applyTheme());

    effect(() => {
      void this.appearanceStore.theme();
      this.applyTheme();
    });
  }

  private applyTheme(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const theme = this.appearanceStore.theme();
    const html = document.documentElement;

    if (theme === 'system') {
      if (this.mediaQueryList?.matches) html.classList.add('dark');
      else html.classList.remove('dark');
    } else if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }

  initialize(): void {
    this.applyTheme();
  }
}
