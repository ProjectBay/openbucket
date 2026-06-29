import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'hlm-hint',
})
export class HlmHint {
  constructor() {
    classes(() => 'text-muted-foreground block text-sm');
  }
}
