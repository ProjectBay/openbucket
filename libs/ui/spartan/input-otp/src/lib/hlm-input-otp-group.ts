import { Directive } from '@angular/core';
import { classes } from '@openbucket/spartan-ui/utils';

@Directive({
  selector: '[hlmInputOtpGroup]',
  host: {
    'data-slot': 'input-otp-group',
  },
})
export class HlmInputOtpGroup {
  constructor() {
    classes(() => 'flex items-center');
  }
}
