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
  selector: 'ob-sticky-sidebar',
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
            <ob-sidebar-renderer [config]="mainConfig" />
            <ob-sidebar-renderer
              [config]="secondaryConfig"
              class="mt-auto"
            />
          </hlm-sidebar-content>

          <hlm-sidebar-footer>
            <ob-account-menu />
          </hlm-sidebar-footer>
        </hlm-sidebar>
        <ng-content />
      </div>
    </div>
  `,
})
export class StickySidebar {
  protected readonly mainConfig = sidebarConfig;
  protected readonly secondaryConfig = secondaryNavConfig;
}
