import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmAutocompleteEmpty]',
})
export class HlmAutocompleteEmpty {
  constructor() {
    classes(() => 'py-6 text-center text-sm');
  }
}
