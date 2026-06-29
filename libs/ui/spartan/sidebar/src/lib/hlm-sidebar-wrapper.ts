import { Directive, input } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';
import { injectHlmSidebarConfig } from './hlm-sidebar.token';

@Directive({
  selector: '[hlmSidebarWrapper],hlm-sidebar-wrapper',
  host: {
    'data-slot': 'sidebar-wrapper',
    '[style.--sidebar-width]': 'sidebarWidth()',
    '[style.--sidebar-width-icon]': 'sidebarWidthIcon()',
  },
})
export class HlmSidebarWrapper {
  private readonly _config = injectHlmSidebarConfig();

  public readonly sidebarWidth = input<string>(this._config.sidebarWidth);
  public readonly sidebarWidthIcon = input<string>(
    this._config.sidebarWidthIcon,
  );

  constructor() {
    classes(
      () =>
        'group/sidebar-wrapper has-[[data-variant=inset]]:bg-sidebar has-[[data-variant=compact]]:bg-background flex min-h-svh w-full',
    );
  }
}
