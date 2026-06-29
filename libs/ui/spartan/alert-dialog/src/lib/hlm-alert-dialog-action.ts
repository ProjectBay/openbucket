import { Directive, input } from '@angular/core';
import { HlmButton } from '@openbucket/spartan-ui/button';

@Directive({
  selector: 'button[hlmAlertDialogAction]',
  hostDirectives: [{ directive: HlmButton, inputs: ['variant', 'size'] }],
  host: {
    '[type]': 'type()',
  },
})
export class HlmAlertDialogAction {
  public readonly type = input<'button' | 'submit' | 'reset'>('button');
}
