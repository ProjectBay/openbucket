import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { SidebarRendererComponent } from '../../../sidebar/components/sidebar-renderer.component';
import { BrandComponent } from '../../components/brand.component';
import { AccountMenuComponent } from '../../components/account-menu.component';
import {
  sidebarConfig,
  secondaryNavConfig,
} from '../../../sidebar/data/sidebar.data';

@Component({
  selector: 'ob-compact-sidebar',
  standalone: true,
  imports: [
    HlmSidebarImports,
    SidebarRendererComponent,
    BrandComponent,
    AccountMenuComponent,
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
          <ob-sidebar-renderer [config]="mainConfig" />
        </hlm-sidebar-content>

        <hlm-sidebar-footer>
          <ob-sidebar-renderer [config]="secondaryConfig" />
          <ob-account-menu />
        </hlm-sidebar-footer>
      </hlm-sidebar>
      <ng-content />
    </div>
  `,
})
export class CompactSidebar {
  protected readonly mainConfig = sidebarConfig;
  protected readonly secondaryConfig = secondaryNavConfig;
}
