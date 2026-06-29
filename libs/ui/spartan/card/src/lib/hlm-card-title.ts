import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmCardTitle]',
})
export class HlmCardTitle {
  constructor() {
    classes(() => 'leading-none font-semibold');
  }
}
