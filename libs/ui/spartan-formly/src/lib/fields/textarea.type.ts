import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmTextareaImports } from '@openbucket/spartan-ui/textarea';

/**
 * Formly field type for Spartan Textarea component
 */
@Component({
  selector: 'lib-spartan-formly-field-textarea',
  imports: [ReactiveFormsModule, FormlyModule, HlmTextareaImports],
  template: `
    <textarea
      hlmTextarea
      [id]="id"
      [formControl]="formControl"
      [formlyAttributes]="field"
      [placeholder]="props['placeholder'] || ''"
      [readonly]="props['readonly'] || false"
      [attr.rows]="props['rows']"
      [attr.cols]="props['cols']"
      [attr.maxlength]="props['maxlength']"
      [attr.minlength]="props['minlength']"
      class="w-full"
      [style.resize]="props['resize'] || 'vertical'"
    ></textarea>
  `,
})
export class SpartanFormlyFieldTextarea extends FieldType<FieldTypeConfig> {}
