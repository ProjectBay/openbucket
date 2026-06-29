import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch } from '@ng-icons/lucide';
import { TranslateModule } from '@ngx-translate/core';
import { HlmBreadCrumbImports } from '@openbucket/spartan-ui/breadcrumb';
import { HlmSeparatorImports } from '@openbucket/spartan-ui/separator';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { HlmInputGroupImports } from '@openbucket/spartan-ui/input-group';
import { BreadcrumbService } from '../../services';

@Component({
  selector: 'ob-sticky-header',
  standalone: true,
  imports: [
    HlmSidebarImports,
    HlmSeparatorImports,
    HlmBreadCrumbImports,
    HlmInputGroupImports,
    NgIcon,
    RouterLink,
    TranslateModule,
  ],
  providers: [provideIcons({ lucideSearch })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header
      class="bg-background sticky top-0 z-50 flex w-full items-center border-b"
    >
      <div class="flex h-(--header-height) w-full items-center gap-2 px-4">
        <button
          hlmSidebarTrigger
          aria-label="Toggle sidebar"
        ></button>
        <hlm-separator
          orientation="vertical"
          class="mr-2"
        />

        @if (breadcrumbService.breadcrumbs().length > 0) {
          <nav
            hlmBreadcrumb
            class="hidden sm:block"
          >
            <ol hlmBreadcrumbList>
              @for (
                crumb of breadcrumbService.breadcrumbs();
                track crumb.url;
                let isLast = $last
              ) {
                @if (!isLast) {
                  <li hlmBreadcrumbItem>
                    <a
                      hlmBreadcrumbLink
                      [link]="crumb.url"
                      >{{ crumb.label | translate }}</a
                    >
                  </li>
                  <li hlmBreadcrumbSeparator></li>
                } @else {
                  <li hlmBreadcrumbItem>
                    <a hlmBreadcrumbPage>{{ crumb.label | translate }}</a>
                  </li>
                }
              }
            </ol>
          </nav>
        }

        <div
          hlmInputGroup
          class="w-full sm:ml-auto sm:w-auto"
        >
          <input
            hlmInputGroupInput
            aria-label="Search"
            placeholder="Type to search..."
          />
          <div hlmInputGroupAddon>
            <ng-icon name="lucideSearch" />
          </div>
        </div>
      </div>
    </header>
  `,
})
export class StickyHeader {
  protected readonly breadcrumbService = inject(BreadcrumbService);
}
