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
  selector: 'ob-sticky-sidebar',
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
      class="flex-col h-svh"
    >
      <ng-content select="[header]" />
      <div class="flex flex-1 min-h-0">
        <hlm-sidebar
          sidebarContainerClass="top-(--header-height) h-[calc(100svh-var(--header-height))]"
        >
          <hlm-sidebar-header>
            <ul hlmSidebarMenu>
              <li hlmSidebarMenuItem>
                <a
                  hlmSidebarMenuButton
                  size="lg"
                >
                  <ob-brand [commandTrigger]="true" />
                </a>
              </li>
            </ul>
          </hlm-sidebar-header>

          <hlm-sidebar-content>
            <ob-sidebar-renderer [config]="mainConfig()" />
            <ob-sidebar-renderer
              [config]="secondaryConfig"
              class="mt-auto"
            />
          </hlm-sidebar-content>

          <hlm-sidebar-footer>
            <ob-version-footer />
            <ob-account-menu />
          </hlm-sidebar-footer>
        </hlm-sidebar>
        <ng-content />
      </div>
    </div>
  `,
})
export class StickySidebar {
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
