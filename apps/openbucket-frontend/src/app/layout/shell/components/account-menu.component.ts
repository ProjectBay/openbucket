import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronsUpDown, lucideLogOut } from '@ng-icons/lucide';
import { HlmAvatarImports } from '@openbucket/spartan-ui/avatar';
import { HlmDropdownMenuImports } from '@openbucket/spartan-ui/dropdown-menu';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { AuthService } from '../../../auth/auth.service';

/**
 * Sidebar-footer identity affordance (STORY-0601 / TASK-1808): shows the
 * signed-in admin (avatar + username) and a dropdown to log out via
 * `AuthService.logout()`. Mounted once per shell variant.
 */
@Component({
  selector: 'ob-account-menu',
  standalone: true,
  imports: [NgIcon, ...HlmAvatarImports, HlmDropdownMenuImports, HlmSidebarImports],
  providers: [provideIcons({ lucideChevronsUpDown, lucideLogOut })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul hlmSidebarMenu>
      <li hlmSidebarMenuItem>
        <button
          hlmSidebarMenuButton
          size="lg"
          [hlmDropdownMenuTrigger]="accountMenu"
          side="right"
          align="end"
        >
          <hlm-avatar class="size-8 rounded-lg">
            <span
              hlmAvatarFallback
              class="rounded-lg text-xs"
              >{{ initial() }}</span
            >
          </hlm-avatar>
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-medium">{{ auth.username() ?? 'Account' }}</span>
            <span class="truncate text-xs text-muted-foreground">Administrator</span>
          </div>
          <ng-icon
            name="lucideChevronsUpDown"
            class="ml-auto text-base"
          />
        </button>

        <ng-template #accountMenu>
          <hlm-dropdown-menu class="w-56">
            <hlm-dropdown-menu-group>
              <hlm-dropdown-menu-label>{{ auth.username() ?? 'Signed in' }}</hlm-dropdown-menu-label>
            </hlm-dropdown-menu-group>
            <hlm-dropdown-menu-separator />
            <button
              hlmDropdownMenuItem
              (click)="auth.logout()"
            >
              <ng-icon name="lucideLogOut" />
              Log out
            </button>
          </hlm-dropdown-menu>
        </ng-template>
      </li>
    </ul>
  `,
})
export class AccountMenuComponent {
  protected readonly auth = inject(AuthService);
  protected readonly initial = computed(() =>
    (this.auth.username() ?? 'A').charAt(0).toUpperCase(),
  );
}
