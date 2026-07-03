import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { StickySidebar } from './components/sticky-sidebar.component';
import { StickyHeader } from './components/sticky-header.component';
import { ContentWidthComponent, PageHeaderComponent } from '../components';

@Component({
  selector: 'ob-sticky-shell',
  standalone: true,
  imports: [
    HlmSidebarImports,
    StickySidebar,
    StickyHeader,
    PageHeaderComponent,
    ContentWidthComponent,
    RouterOutlet,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block [--header-height:--spacing(14)]' },
  template: `
    <ob-sticky-sidebar>
      <ob-sticky-header header />
      <main
        hlmSidebarInset
        id="main-content"
        tabindex="-1"
        class="flex flex-col h-full overflow-auto outline-none"
      >
        <ob-page-header />
        <div class="flex-1 overflow-auto min-h-0">
          <ob-content-width>
            <router-outlet />
          </ob-content-width>
        </div>
      </main>
    </ob-sticky-sidebar>
  `,
})
export default class StickyShellLayout {}
