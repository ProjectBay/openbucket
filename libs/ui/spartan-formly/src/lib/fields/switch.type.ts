import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmSwitchImports } from '@openbucket/spartan-ui/switch';
import { BrnSwitchImports } from '@spartan-ng/brain/switch';
import { HlmLabelImports } from '@openbucket/spartan-ui/label';

/**
 * Formly field type for Spartan Switch component
 */
@Component({
  selector: 'lib-spartan-formly-field-switch',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmSwitchImports,
    BrnSwitchImports,
    HlmLabelImports,
  ],
  template: `
    <label
      class="flex items-center cursor-pointer mb-4"
      hlmLabel
    >
      <hlm-switch
        class="mr-2"
        [id]="id"
        [checked]="formControl.value"
        (checkedChange)="formControl.setValue($event)"
        [disabled]="props['disabled'] || false"
      />
      {{ props['switchLabel'] || '' }}
      @if (
        props['required'] &&
        props['hideRequiredMarker'] !== true &&
        props['switchLabel']
      ) {
        <span class="text-destructive ml-1">*</span>
      }
    </label>
  `,
})
export class SpartanFormlyFieldSwitch extends FieldType<FieldTypeConfig> {}
