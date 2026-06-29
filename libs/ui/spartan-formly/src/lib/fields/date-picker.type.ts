import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmDatePickerImports } from '@openbucket/spartan-ui/date-picker';

/**
 * Formly field type for Spartan Date Picker component
 */
@Component({
  selector: 'lib-spartan-formly-field-date-picker',
  imports: [ReactiveFormsModule, FormlyModule, HlmDatePickerImports],
  template: `
    <hlm-date-picker
      [id]="id"
      [formControl]="formControl"
      [disabled]="props['disabled'] || false"
      class="w-full"
    />
  `,
})
export class SpartanFormlyFieldDatePicker extends FieldType<FieldTypeConfig> {}
