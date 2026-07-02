import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { CompactSidebar } from './components/compact-sidebar.component';
import { CompactHeader } from './components/compact-header.component';
import { PageHeaderComponent } from '../components';

@Component({
  selector: 'ob-compact-shell',
  standalone: true,
  imports: [
    HlmSidebarImports,
    CompactSidebar,
    CompactHeader,
    PageHeaderComponent,
    RouterOutlet,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ob-compact-sidebar>
      <main
        hlmSidebarInset
        id="main-content"
        tabindex="-1"
        class="flex flex-col h-full overflow-auto outline-none"
      >
        <ob-compact-header class="sticky top-0 bg-background z-10" />
        <div class="flex-1 flex flex-col bg-muted/10 min-h-0">
          <!-- Full page header (title + subtitle + primary action). Previously
               rendered <ob-page-subheader> (subtitle only), which dropped the page
               title AND the primary action on the default (compact) variant. -->
          <ob-page-header />
          <div class="flex-1 overflow-auto">
            <router-outlet />
          </div>
        </div>
      </main>
    </ob-compact-sidebar>
  `,
})
export default class CompactShellLayout {}
