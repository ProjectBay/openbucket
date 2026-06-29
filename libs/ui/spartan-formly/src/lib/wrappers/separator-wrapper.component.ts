import { Component } from '@angular/core';
import { FieldWrapper, FormlyModule } from '@ngx-formly/core';
import { HlmFieldImports } from '@openbucket/spartan-ui/field';

/**
 * Wrapper component that adds a field separator after the field
 * Usage: Add 'separator' to the wrappers array in your field config
 */
@Component({
  selector: 'lib-spartan-formly-wrapper-separator',
  imports: [FormlyModule, HlmFieldImports],
  template: `
    <ng-container #fieldComponent></ng-container>
    <hlm-field-separator />
  `,
})
export class SpartanFormlySeparatorWrapperComponent extends FieldWrapper {}
