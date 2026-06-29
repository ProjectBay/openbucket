import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'hlm-error',
})
export class HlmError {
  constructor() {
    classes(() => 'text-destructive block text-sm font-medium');
  }
}
