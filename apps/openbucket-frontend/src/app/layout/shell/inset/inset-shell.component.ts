import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { InsetSidebar } from './components/inset-sidebar.component';
import { InsetHeader } from './components/inset-header.component';
import { ContentWidthComponent, PageHeaderComponent } from '../components';

@Component({
  selector: 'ob-inset-shell',
  standalone: true,
  imports: [
    HlmSidebarImports,
    InsetSidebar,
    InsetHeader,
    PageHeaderComponent,
    ContentWidthComponent,
    RouterOutlet,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ob-inset-sidebar>
      <main
        hlmSidebarInset
        id="main-content"
        tabindex="-1"
        class="flex flex-col min-h-0 outline-none"
      >
        <ob-inset-header />
        <ob-page-header />
        <div class="flex-1 overflow-auto min-h-0">
          <ob-content-width>
            <router-outlet />
          </ob-content-width>
        </div>
      </main>
    </ob-inset-sidebar>
  `,
})
export default class InsetShellLayout {}
