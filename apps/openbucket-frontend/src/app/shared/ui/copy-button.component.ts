import { ChangeDetectionStrategy, Component, OnDestroy, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCopy } from '@ng-icons/lucide';
import { HlmButton } from '@openbucket/spartan-ui/button';

import { notify } from './notify';

/**
 * One-click copy-to-clipboard with feedback (STORY-0600 / TASK-1802). Copies
 * `value`, fires a "Copied" toast, swaps the icon to a check for ~1.5s, and
 * carries an accessible name (`aria-label` + native title) — used for access-key
 * IDs/secrets, ETags, version IDs, and share links across EPIC-07.
 */
@Component({
  selector: 'ob-copy-button',
  standalone: true,
  imports: [HlmButton, NgIcon],
  providers: [provideIcons({ lucideCopy, lucideCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      hlmBtn
      variant="ghost"
      size="icon-sm"
      type="button"
      [attr.aria-label]="label()"
      [title]="label()"
      (click)="copy()"
    >
      <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" class="text-base" />
    </button>
  `,
})
export class CopyButtonComponent implements OnDestroy {
  readonly value = input.required<string>();
  readonly label = input('Copy');

  protected readonly copied = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value());
      notify.success('Copied');
      this.copied.set(true);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.copied.set(false), 1500);
    } catch {
      notify.error('Copy failed');
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
