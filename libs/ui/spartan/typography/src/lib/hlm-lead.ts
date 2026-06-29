import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

export const hlmLead = 'text-xl text-muted-foreground';

@Directive({
  selector: '[hlmLead]',
})
export class HlmLead {
  constructor() {
    classes(() => hlmLead);
  }
}
