import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

export const hlmBlockquote = 'mt-6 border-border border-l-2 pl-6 italic';

@Directive({
  selector: '[hlmBlockquote]',
})
export class HlmBlockquote {
  constructor() {
    classes(() => hlmBlockquote);
  }
}
