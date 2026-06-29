import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HlmBreadCrumbImports } from '@openbucket/spartan-ui/breadcrumb';
import { HlmSeparatorImports } from '@openbucket/spartan-ui/separator';
import { HlmSidebarImports } from '@openbucket/spartan-ui/sidebar';
import { BreadcrumbService } from '../../services';

@Component({
  selector: 'ob-inset-header',
  standalone: true,
  imports: [
    HlmSidebarImports,
    HlmSeparatorImports,
    HlmBreadCrumbImports,
    RouterLink,
    TranslateModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="flex h-16 shrink-0 items-center gap-2">
      <div class="flex items-center gap-2 px-4">
        <button
          hlmSidebarTrigger
          aria-label="Toggle sidebar"
        ></button>
        <hlm-separator
          orientation="vertical"
          class="mr-2 data-[orientation=vertical]:h-4"
        />

        @if (breadcrumbService.breadcrumbs().length > 0) {
          <nav hlmBreadcrumb>
            <ol hlmBreadcrumbList>
              @for (
                crumb of breadcrumbService.breadcrumbs();
                track crumb.url;
                let isLast = $last
              ) {
                @if (!isLast) {
                  <li
                    hlmBreadcrumbItem
                    class="hidden sm:block"
                  >
                    <a
                      hlmBreadcrumbLink
                      [link]="crumb.url"
                      >{{ crumb.label | translate }}</a
                    >
                  </li>
                  <li
                    hlmBreadcrumbSeparator
                    class="hidden sm:block"
                  ></li>
                } @else {
                  <li hlmBreadcrumbItem>
                    <a hlmBreadcrumbPage>{{ crumb.label | translate }}</a>
                  </li>
                }
              }
            </ol>
          </nav>
        }
      </div>
    </header>
  `,
})
export class InsetHeader {
  protected readonly breadcrumbService = inject(BreadcrumbService);
}
