import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmDatePickerImports } from '@openbucket/spartan-ui/date-picker';

/**
 * Formly field type for Spartan Date Range Picker component
 */
@Component({
  selector: 'lib-spartan-formly-field-date-range-picker',
  imports: [ReactiveFormsModule, FormlyModule, HlmDatePickerImports],
  template: `
    <hlm-date-range-picker
      [buttonId]="id"
      [formControl]="formControl"
      [disabled]="props['disabled'] || false"
      [min]="props['minDate']"
      [max]="props['maxDate']"
      [autoCloseOnEndSelection]="props['autoCloseOnEndSelection'] ?? true"
    >
      <span>{{ props['placeholder'] || 'Select date range' }}</span>
    </hlm-date-range-picker>
  `,
})
export class SpartanFormlyFieldDateRangePicker extends FieldType<FieldTypeConfig> {}
