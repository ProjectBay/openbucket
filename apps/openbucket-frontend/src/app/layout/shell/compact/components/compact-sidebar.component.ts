import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { SidebarRendererComponent } from '../../../sidebar/components/sidebar-renderer.component';
import { BrandComponent } from '../../components/brand.component';
import { AccountMenuComponent } from '../../components/account-menu.component';
import { VersionFooterComponent } from '../../components/version-footer.component';
import {
  sidebarConfig,
  secondaryNavConfig,
  sidebarConfigForRole,
  sidebarConfigWithIntegrityBadge,
} from '../../../sidebar/data/sidebar.data';
import { AuthService } from '../../../../auth/auth.service';
import { IntegritySignalStore } from '../../../../integrity/integrity.signal-store';

@Component({
  selector: 'ob-compact-sidebar',
  standalone: true,
  imports: [
    HlmSidebarImports,
    SidebarRendererComponent,
    BrandComponent,
    AccountMenuComponent,
    VersionFooterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      hlmSidebarWrapper
      class="h-svh"
    >
      <hlm-sidebar
        variant="compact"
        class="border-r"
      >
        <hlm-sidebar-header class="border-b h-16">
          <ul
            hlmSidebarMenu
            class="h-full"
          >
            <li
              hlmSidebarMenuItem
              class="h-full"
            >
              <a
                hlmSidebarMenuButton
                size="lg"
                class="h-full"
              >
                <ob-brand [commandTrigger]="true" />
              </a>
            </li>
          </ul>
        </hlm-sidebar-header>

        <hlm-sidebar-content>
          <ob-sidebar-renderer [config]="mainConfig()" />
        </hlm-sidebar-content>

        <hlm-sidebar-footer>
          <ob-sidebar-renderer [config]="secondaryConfig" />
          <ob-version-footer />
          <ob-account-menu />
        </hlm-sidebar-footer>
      </hlm-sidebar>
      <ng-content />
    </div>
  `,
})
export class CompactSidebar {
  private readonly auth = inject(AuthService);
  private readonly integrity = inject(IntegritySignalStore);
  // Role-filtered (EPIC-11): the full-admin-only /users entry is hidden from
  // read-only admins.
  protected readonly mainConfig = computed(() =>
    sidebarConfigWithIntegrityBadge(
      sidebarConfigForRole(sidebarConfig, this.auth.isFullAdmin()),
      this.integrity.corrupt(),
    ),
  );

  constructor() {
    // Load the corrupt count once so the console indicator badge reflects it.
    void this.integrity.refresh();
  }
  protected readonly secondaryConfig = secondaryNavConfig;
}
