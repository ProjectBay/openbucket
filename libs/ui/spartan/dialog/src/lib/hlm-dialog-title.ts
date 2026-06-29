import { Directive } from '@angular/core';
import { BrnDialogTitle } from '@spartan-ng/brain/dialog';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmDialogTitle]',
  hostDirectives: [BrnDialogTitle],
  host: {
    'data-slot': 'dialog-title',
  },
})
export class HlmDialogTitle {
  constructor() {
    classes(() => 'text-lg leading-none font-semibold');
  }
}
