import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';

/**
 * 404 page (STORY-0602 / TASK-1812). Unknown routes render this inside the shell
 * (keeping the sidebar/header) instead of silently redirecting to the bucket list.
 */
@Component({
  selector: 'ob-not-found',
  standalone: true,
  imports: [RouterLink, TranslateModule, ...HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center gap-4 p-6 py-24 text-center">
      <p class="text-6xl font-bold tracking-tight text-muted-foreground">404</p>
      <h1 class="text-2xl font-semibold tracking-tight">
        {{ 'notFound.title' | translate }}
      </h1>
      <p class="max-w-md text-sm text-muted-foreground">
        {{ 'notFound.message' | translate }}
      </p>
      <a
        hlmBtn
        routerLink="/"
        class="mt-2"
        >{{ 'notFound.backHome' | translate }}</a
      >
    </div>
  `,
})
export class NotFoundComponent {}
