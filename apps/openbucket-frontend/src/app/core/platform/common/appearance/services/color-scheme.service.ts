import {
  Injectable,
  Renderer2,
  RendererFactory2,
  effect,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { AppearanceStore } from '../store/appearance.store';

@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private readonly appearanceStore = inject(AppearanceStore);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly renderer: Renderer2;
  private currentLink?: HTMLLinkElement;

  constructor() {
    this.renderer = inject(RendererFactory2).createRenderer(null, null);
    if (!isPlatformBrowser(this.platformId)) return;

    effect(() => {
      void this.appearanceStore.colorScheme();
      this.applyColorScheme();
    });
  }

  private applyColorScheme(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const scheme = this.appearanceStore.colorScheme();
    const link: HTMLLinkElement = this.renderer.createElement('link');
    this.renderer.setAttribute(link, 'rel', 'stylesheet');
    this.renderer.setAttribute(link, 'href', `${scheme}.css`);
    this.renderer.setAttribute(link, 'data-theme', scheme);
    this.renderer.appendChild(this.document.head, link);

    setTimeout(() => {
      if (this.currentLink) {
        this.renderer.removeChild(this.document.head, this.currentLink);
      }
      this.currentLink = link;
    }, 100);
  }

  initialize(): void {
    this.applyColorScheme();
  }
}
