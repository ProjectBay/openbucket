import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmItemFooter],hlm-item-footer',
  host: {
    'data-slot': 'item-footer',
  },
})
export class HlmItemFooter {
  constructor() {
    classes(() => 'flex basis-full items-center justify-between gap-2');
  }
}
