import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideInfo } from '@ng-icons/lucide';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';

import { UpdatesService } from '../../../shared/updates/updates.service';

/**
 * Sidebar-footer version line (above the account card): shows the running
 * OpenBucket version and a notification dot when a newer release is available.
 * Links to the About page. Reads shared {@link UpdatesService} state.
 */
@Component({
  selector: 'ob-version-footer',
  standalone: true,
  imports: [RouterLink, NgIcon, TranslateModule, HlmSidebarImports],
  providers: [provideIcons({ lucideInfo })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul hlmSidebarMenu>
      <li hlmSidebarMenuItem>
        <a
          hlmSidebarMenuButton
          routerLink="/about"
          class="text-muted-foreground"
          [title]="'about.title' | translate"
        >
          <ng-icon name="lucideInfo" class="text-base" />
          <span class="truncate text-xs">
            OpenBucket{{ updates.current() ? ' v' + updates.current() : '' }}
          </span>
          @if (updates.updateAvailable()) {
            <span class="relative ml-auto flex size-2 shrink-0">
              <span class="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60"></span>
              <span class="bg-primary relative inline-flex size-2 rounded-full"></span>
            </span>
          }
        </a>
      </li>
    </ul>
  `,
})
export class VersionFooterComponent implements OnInit {
  protected readonly updates = inject(UpdatesService);

  ngOnInit(): void {
    this.updates.ensureLoaded();
  }
}
