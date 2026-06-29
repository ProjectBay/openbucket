import { Directive } from '@angular/core';
import { BrnSheetTitle } from '@spartan-ng/brain/sheet';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmSheetTitle]',
  hostDirectives: [BrnSheetTitle],
  host: {
    'data-slot': 'sheet-title',
  },
})
export class HlmSheetTitle {
  constructor() {
    classes(() => 'text-foreground font-semibold');
  }
}
