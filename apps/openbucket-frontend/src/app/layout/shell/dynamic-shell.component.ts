import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import InsetShellLayout from './inset/inset-shell.component';
import StickyShellLayout from './sticky/sticky-shell.component';
import CompactShellLayout from './compact/compact-shell.component';
import { ShellLayoutService } from './services/shell-layout.service';
import { CommandPaletteComponent } from './command-palette.component';
import { PageHeaderService } from './services';
import { StatusAnnouncer } from '../../shared/ui/status-announcer.service';

@Component({
  selector: 'ob-dynamic-shell',
  standalone: true,
  imports: [InsetShellLayout, StickyShellLayout, CompactShellLayout, CommandPaletteComponent],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      href="#main-content"
      class="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
    >
      Skip to main content
    </a>

    @if (shellLayout.variant() === 'inset') {
      <ob-inset-shell />
    } @else if (shellLayout.variant() === 'sticky') {
      <ob-sticky-shell />
    } @else if (shellLayout.variant() === 'compact') {
      <ob-compact-shell />
    }

    <ob-command-palette />
  `,
})
export default class DynamicShellLayout {
  protected readonly shellLayout = inject(ShellLayoutService);
  private readonly router = inject(Router);
  private readonly announcer = inject(StatusAnnouncer);
  private readonly pageHeader = inject(PageHeaderService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // On every navigation, move focus to <main> and announce the page (WCAG 2.4.3 / 4.1.3).
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        setTimeout(() => {
          document.getElementById('main-content')?.focus();
          const title = this.pageHeader.pageTitle();
          if (title) this.announcer.announce(this.translate.instant(title));
        }, 150);
      });
  }
}
