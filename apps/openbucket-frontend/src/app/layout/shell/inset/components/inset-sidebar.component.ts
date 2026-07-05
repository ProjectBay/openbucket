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
} from '../../../sidebar/data/sidebar.data';
import { AuthService } from '../../../../auth/auth.service';

@Component({
  selector: 'ob-inset-sidebar',
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
      <hlm-sidebar variant="inset">
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
  `,
})
export class InsetSidebar {
  private readonly auth = inject(AuthService);
  // Role-filtered (EPIC-11): the full-admin-only /users entry is hidden from
  // read-only admins.
  protected readonly mainConfig = computed(() =>
    sidebarConfigForRole(sidebarConfig, this.auth.isFullAdmin()),
  );
  protected readonly secondaryConfig = secondaryNavConfig;
}
