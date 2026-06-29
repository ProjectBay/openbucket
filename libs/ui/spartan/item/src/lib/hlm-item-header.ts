import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmItemHeader],hlm-item-header',
  host: {
    'data-slot': 'item-header',
  },
})
export class HlmItemHeader {
  constructor() {
    classes(() => 'flex basis-full items-center justify-between gap-2');
  }
}
