import { Injectable, computed, inject } from '@angular/core';
import { AppearanceStore } from '../../../core/platform/common/appearance';

export type ShellVariant = 'inset' | 'sticky' | 'compact';

@Injectable({ providedIn: 'root' })
export class ShellLayoutService {
  private readonly appearanceStore = inject(AppearanceStore);

  readonly variant = computed(() => this.appearanceStore.shellVariant());

  setVariant(variant: ShellVariant): void {
    this.appearanceStore.setShellVariant(variant);
  }

  toggle(): void {
    const current = this.variant();
    if (current === 'inset') this.setVariant('sticky');
    else if (current === 'sticky') this.setVariant('compact');
    else this.setVariant('inset');
  }

  isInset(): boolean {
    return this.variant() === 'inset';
  }
  isSticky(): boolean {
    return this.variant() === 'sticky';
  }
  isCompact(): boolean {
    return this.variant() === 'compact';
  }
}
