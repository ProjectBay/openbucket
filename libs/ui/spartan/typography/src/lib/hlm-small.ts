import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

export const hlmSmall = 'text-sm font-medium leading-none';

@Directive({
  selector: '[hlmSmall]',
})
export class HlmSmall {
  constructor() {
    classes(() => hlmSmall);
  }
}
