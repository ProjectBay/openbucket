import { Injectable } from '@angular/core';

/**
 * Lets any component (e.g. the brand mark) open the ⌘K command palette without a
 * direct reference. The palette registers its `open` callback on init.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private opener: (() => void) | null = null;

  register(open: () => void): void {
    this.opener = open;
  }

  open(): void {
    this.opener?.();
  }
}
