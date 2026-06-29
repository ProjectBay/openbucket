import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: 'li[hlmSidebarMenuItem]',
  host: {
    'data-slot': 'sidebar-menu-item',
    'data-sidebar': 'menu-item',
  },
})
export class HlmSidebarMenuItem {
  constructor() {
    classes(() => 'group/menu-item relative');
  }
}
