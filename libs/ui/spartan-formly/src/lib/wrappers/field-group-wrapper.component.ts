import { Component } from '@angular/core';
import { FieldWrapper, FormlyModule } from '@ngx-formly/core';
import { HlmFieldImports } from '@openbucket/spartan-ui/field';

/**
 * Wrapper component that provides a field group container
 * Usage: Add 'fieldGroup' to the wrappers array in your field config
 */
@Component({
  selector: 'lib-spartan-formly-wrapper-field-group',
  imports: [FormlyModule, HlmFieldImports],
  template: `
    <div hlmFieldGroup>
      <ng-container #fieldComponent></ng-container>
    </div>
  `,
})
export class SpartanFormlyFieldGroupWrapperComponent extends FieldWrapper {}
