import { Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  lucideArchive,
  lucideChevronDown,
  lucideChevronRight,
  lucideDatabase,
  lucideKey,
  lucideLayoutDashboard,
  lucideSettings,
} from '@ng-icons/lucide';
import { HlmCollapsibleImports } from '@openbucket/spartan-ui/collapsible';
import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';
import { HlmSidebarImports, HlmSidebarService } from '@openbucket/spartan-ui/sidebar';
import { HlmIcon } from '@openbucket/spartan-ui/icon';
import { HlmBadgeImports } from '@openbucket/spartan-ui/badge';
import { SidebarConfig } from '../types';

@Component({
  selector: 'ob-sidebar-renderer',
  standalone: true,
  imports: [
    HlmSidebarImports,
    HlmCollapsibleImports,
    HlmDropdownMenuImports,
    HlmIcon,
    ...HlmBadgeImports,
    NgIcon,
    RouterLink,
    RouterLinkActive,
    NgTemplateOutlet,
    TranslateModule,
  ],
  providers: [
    provideIcons({
      lucideArchive,
      lucideChevronDown,
      lucideChevronRight,
      lucideDatabase,
      lucideKey,
      lucideLayoutDashboard,
      lucideSettings,
    }),
  ],
  template: `
    @for (group of config().groups; track group.id) {
      @if (group.collapsible) {
        <hlm-collapsible
          [expanded]="group.defaultOpen ?? false"
          class="group/collapsible"
        >
          <div hlmSidebarGroup>
            @if (group.label) {
              <button
                hlmCollapsibleTrigger
                hlmSidebarGroupLabel
                class="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sm"
              >
                {{ group.label | translate }}
                <ng-icon
                  hlm
                  name="lucideChevronDown"
                  class="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180"
                />
              </button>
            }
            <hlm-collapsible-content>
              <div hlmSidebarGroupContent>
                <ng-container
                  *ngTemplateOutlet="groupItems; context: { $implicit: group }"
                />
              </div>
            </hlm-collapsible-content>
          </div>
        </hlm-collapsible>
      } @else {
        <hlm-sidebar-group>
          @if (group.label) {
            <div hlmSidebarGroupLabel>{{ group.label | translate }}</div>
          }
          @if (group.groupAction) {
            <button
              hlmSidebarGroupAction
              [title]="group.groupAction.title"
              (click)="group.groupAction.onClick?.()"
            >
              <ng-icon
                hlm
                [name]="group.groupAction.icon"
              />
              <span class="sr-only">{{ group.groupAction.ariaLabel }}</span>
            </button>
          }
          <div hlmSidebarGroupContent>
            <ng-container
              *ngTemplateOutlet="groupItems; context: { $implicit: group }"
            />
          </div>
        </hlm-sidebar-group>
      }
    }

    <ng-template
      #groupItems
      let-group
    >
      <ul hlmSidebarMenu>
        @for (item of group.items; track item.type + '-' + $index) {
          @switch (item.type) {
            @case ('item') {
              <li hlmSidebarMenuItem>
                <a
                  hlmSidebarMenuButton
                  [routerLink]="item.url"
                  routerLinkActive="group-data-[active=true]:bg-sidebar-accent group-data-[active=true]:text-sidebar-accent-foreground"
                  [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
                  #rla="routerLinkActive"
                  [isActive]="rla.isActive"
                >
                  @if (item.icon) {
                    <ng-icon
                      [name]="item.icon"
                      aria-hidden="true"
                    />
                  }
                  <span>{{ item.title | translate }}</span>
                </a>
                @if (item.badge) {
                  <div hlmSidebarMenuBadge>{{ item.badge.content | translate }}</div>
                }
                @if (item.action) {
                  <ng-container
                    *ngTemplateOutlet="
                      itemAction;
                      context: { $implicit: item.action, item: item }
                    "
                  />
                }
              </li>
            }
            @case ('collapsible') {
              <hlm-collapsible
                [expanded]="item.defaultOpen ?? false"
                class="group/collapsible"
              >
                <li hlmSidebarMenuItem>
                  <a
                    hlmSidebarMenuButton
                    [routerLink]="item.url"
                    routerLinkActive="group-data-[active=true]:bg-sidebar-accent group-data-[active=true]:text-sidebar-accent-foreground"
                    [routerLinkActiveOptions]="{ exact: false }"
                    #rla="routerLinkActive"
                    [isActive]="rla.isActive"
                  >
                    @if (item.icon) {
                      <ng-icon
                      [name]="item.icon"
                      aria-hidden="true"
                    />
                    }
                    {{ item.title | translate }}
                  </a>
                  <button
                    hlmCollapsibleTrigger
                    hlmSidebarMenuAction
                    class="data-[state=open]:rotate-90"
                  >
                    <ng-icon name="lucideChevronRight" />
                  </button>
                  <hlm-collapsible-content>
                    <ul hlmSidebarMenuSub>
                      @for (subItem of item.items; track $index) {
                        <li hlmSidebarMenuSubItem>
                          <a
                            hlmSidebarMenuSubButton
                            [routerLink]="subItem.url"
                            routerLinkActive="bg-sidebar-accent text-sidebar-accent-foreground"
                            [routerLinkActiveOptions]="{ exact: false }"
                            >{{ subItem.title | translate }}</a
                          >
                        </li>
                      }
                    </ul>
                  </hlm-collapsible-content>
                </li>
              </hlm-collapsible>
            }
            @case ('submenu') {
              <li hlmSidebarMenuItem>
                <a
                  hlmSidebarMenuButton
                  [routerLink]="item.url"
                  routerLinkActive="group-data-[active=true]:bg-sidebar-accent group-data-[active=true]:text-sidebar-accent-foreground"
                  [routerLinkActiveOptions]="{ exact: false }"
                  #rla="routerLinkActive"
                  [isActive]="rla.isActive"
                >
                  @if (item.icon) {
                    <ng-icon
                      [name]="item.icon"
                      aria-hidden="true"
                    />
                  }
                  <span>{{ item.title | translate }}</span>
                </a>
                <ul hlmSidebarMenuSub>
                  @for (subItem of item.items; track $index) {
                    <li hlmSidebarMenuSubItem>
                      <a
                        hlmSidebarMenuSubButton
                        class="w-full"
                        [routerLink]="subItem.url"
                        routerLinkActive="bg-sidebar-accent text-sidebar-accent-foreground"
                        [routerLinkActiveOptions]="{ exact: false }"
                      >
                        <span>{{ subItem.title | translate }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </li>
            }
            @case ('separator') {
              <div hlmSidebarSeparator></div>
            }
            @case ('skeleton') {
              @for (_ of Array(item.count || 3); track $index) {
                <li hlmSidebarMenuItem>
                  <div hlmSidebarMenuSkeleton></div>
                </li>
              }
            }
          }
        }
      </ul>
    </ng-template>

    <ng-template
      #itemAction
      let-action
      let-item="item"
    >
      @if (action.type === 'dropdown') {
        <button
          hlmSidebarMenuAction
          [showOnHover]="action.showOnHover"
          [hlmDropdownMenuTrigger]="dropdownMenu"
          [hlmDropdownMenuTriggerData]="{ $implicit: { item, action } }"
          [side]="_menuSide()"
          [align]="_menuAlign()"
        >
          @if (action.icon) {
            <ng-icon [name]="action.icon" />
          }
          <span class="sr-only">{{ action.ariaLabel }}</span>
        </button>

        <ng-template
          #dropdownMenu
          let-ctx
        >
          <hlm-dropdown-menu class="w-48">
            @for (menuItem of action.menuItems; track $index) {
              @if (menuItem.separator) {
                <hlm-dropdown-menu-separator />
              } @else if (menuItem.isLabel) {
                <hlm-dropdown-menu-group>
                  <hlm-dropdown-menu-label>{{
                    menuItem.label | translate
                  }}</hlm-dropdown-menu-label>
                </hlm-dropdown-menu-group>
              } @else {
                <button
                  hlmDropdownMenuItem
                  [disabled]="menuItem.disabled"
                  (click)="menuItem.onClick?.()"
                >
                  @if (menuItem.icon) {
                    <ng-icon [name]="menuItem.icon" />
                  }
                  {{ menuItem.label | translate }}
                </button>
              }
            }
          </hlm-dropdown-menu>
        </ng-template>
      } @else if (action.type === 'button') {
        <button
          hlmSidebarMenuAction
          (click)="action.onClick?.()"
        >
          @if (action.icon) {
            <ng-icon [name]="action.icon" />
          }
          <span class="sr-only">{{ action.ariaLabel }}</span>
        </button>
      }
    </ng-template>
  `,
})
export class SidebarRendererComponent {
  private readonly _sidebarService = inject(HlmSidebarService);

  public readonly config = input.required<SidebarConfig>();

  protected readonly Array = Array;

  protected readonly _menuSide = computed(() =>
    this._sidebarService.isMobile() ? 'bottom' : 'right',
  );
  protected readonly _menuAlign = computed(() =>
    this._sidebarService.isMobile() ? 'end' : 'start',
  );
}
