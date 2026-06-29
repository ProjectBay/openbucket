import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmBreadcrumbItem]',
})
export class HlmBreadcrumbItem {
  constructor() {
    classes(() => 'inline-flex items-center gap-1.5');
  }
}
