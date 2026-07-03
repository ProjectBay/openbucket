import { inject, Injectable, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class PageHeaderService {
  private readonly _pageTitle = signal<string>('');
  private readonly _pageSubtitle = signal<string>('');
  private readonly _showAction = signal<boolean>(false);
  private readonly _actionLabel = signal<string>('Quick Create');
  private readonly _hasTabs = signal<boolean>(false);
  private _actionCallback: (() => void) | null = null;

  readonly pageTitle = this._pageTitle.asReadonly();
  readonly pageSubtitle = this._pageSubtitle.asReadonly();
  readonly showAction = this._showAction.asReadonly();
  readonly actionLabel = this._actionLabel.asReadonly();
  readonly hasTabs = this._hasTabs.asReadonly();

  constructor() {
    // Clear header state when navigating to a different PAGE so a route that
    // doesn't set (part of) the header never inherits the previous route's title /
    // subtitle / action / tabs. Fires before the next route's component sets its
    // own header, so pages no longer need manual ngOnDestroy cleanup.
    //
    // Only reset on a PATH change — NOT on query-param/fragment-only navigations
    // (e.g. switching a `?tab=` within a tabbed page), which must keep the header
    // the current page already set.
    const router = inject(Router);
    router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        const nextPath = e.url.split(/[?#]/)[0];
        const currentPath = router.url.split(/[?#]/)[0];
        if (nextPath !== currentPath) this.reset();
      }
    });
  }

  /** Reset the header to empty (called automatically on navigation). */
  reset(): void {
    this._pageTitle.set('');
    this._pageSubtitle.set('');
    this._hasTabs.set(false);
    this._showAction.set(false);
    this._actionCallback = null;
  }

  setTitle(title: string): void {
    this._pageTitle.set(title);
  }

  setSubtitle(subtitle: string): void {
    this._pageSubtitle.set(subtitle);
  }

  setPageHeader(title: string, subtitle = ''): void {
    this._pageTitle.set(title);
    this._pageSubtitle.set(subtitle);
  }

  setHasTabs(hasTabs: boolean): void {
    this._hasTabs.set(hasTabs);
  }

  setActionButton(label: string, callback: () => void): void {
    this._actionLabel.set(label);
    this._actionCallback = callback;
    this._showAction.set(true);
  }

  hideActionButton(): void {
    this._showAction.set(false);
    this._actionCallback = null;
  }

  executeAction(): void {
    this._actionCallback?.();
  }
}
