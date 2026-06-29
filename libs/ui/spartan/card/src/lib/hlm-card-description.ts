import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmCardDescription]',
})
export class HlmCardDescription {
  constructor() {
    classes(() => 'text-muted-foreground text-sm');
  }
}
