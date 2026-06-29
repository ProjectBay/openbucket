import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmMultiselectImports } from '@openbucket/spartan-ui/multiselect';

/**
 * Formly field type for Multiselect with chips display
 */
@Component({
  selector: 'lib-spartan-formly-field-multiselect',
  imports: [ReactiveFormsModule, FormlyModule, HlmMultiselectImports],
  template: `
    <hlm-multiselect
      [formControl]="formControl"
      [options]="getOptions()"
      [placeholder]="props['placeholder'] || 'Select items'"
      [dropdownLabel]="props['dropdownLabel'] || 'Select items'"
    />
  `,
})
export class SpartanFormlyFieldMultiselect extends FieldType<FieldTypeConfig> {
  getOptions(): Array<{ label: string; value: unknown; disabled?: boolean }> {
    const options = this.props['options'];
    return Array.isArray(options) ? options : [];
  }
}
