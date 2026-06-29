import { Component } from '@angular/core';
import { FieldWrapper, FormlyModule } from '@ngx-formly/core';
import { HlmFieldImports } from '@openbucket/spartan-ui/field';
import { HlmSeparatorImports } from '@openbucket/spartan-ui/separator';

/**
 * Wrapper component that provides a fieldset with legend and description
 * Usage: Add 'fieldset' to the wrappers array in your field config
 * Props:
 *   - fieldsetLegend: string - The legend text for the fieldset
 *   - fieldsetDescription: string - Optional description text
 *   - fieldsetSeparator: boolean - Whether to add a separator after the fieldset (default: false)
 */
@Component({
  selector: 'lib-spartan-formly-wrapper-fieldset',
  imports: [FormlyModule, HlmFieldImports, HlmSeparatorImports],
  template: `
    <fieldset hlmFieldSet>
      @if (props['fieldsetLegend']) {
        <legend hlmFieldLegend>{{ props['fieldsetLegend'] }}</legend>
      }
      @if (props['fieldsetDescription']) {
        <p hlmFieldDescription>{{ props['fieldsetDescription'] }}</p>
      }
      <div hlmFieldGroup>
        <ng-container #fieldComponent></ng-container>
      </div>
    </fieldset>
    @if (props['fieldsetSeparator']) {
      <span
        hlmSeparator
        class="my-6"
      ></span>
    }
  `,
})
export class SpartanFormlyFieldsetWrapperComponent extends FieldWrapper {}
