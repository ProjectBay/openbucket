import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { PageHeaderService } from '../services';

@Component({
  selector: 'ob-page-subheader',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pageHeader.pageSubtitle()) {
      <div
        class="bg-background px-6 py-3"
        [class.border-b]="!pageHeader.hasTabs()"
      >
        <p class="text-sm text-muted-foreground">
          {{ pageHeader.pageSubtitle() | translate }}
        </p>
      </div>
    }
  `,
})
export class PageSubheaderComponent {
  protected readonly pageHeader = inject(PageHeaderService);
}
