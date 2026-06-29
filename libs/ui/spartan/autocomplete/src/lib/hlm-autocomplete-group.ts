import { Directive } from '@angular/core';
import { BrnAutocompleteGroup } from '@spartan-ng/brain/autocomplete';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmAutocompleteGroup],hlm-autocomplete-group',
  hostDirectives: [
    {
      directive: BrnAutocompleteGroup,
      inputs: ['id'],
    },
  ],
})
export class HlmAutocompleteGroup {
  constructor() {
    classes(() => 'text-foreground block overflow-hidden p-1');
  }
}
