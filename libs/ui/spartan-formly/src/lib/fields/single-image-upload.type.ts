import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmSingleImageUploadImports } from '@openbucket/spartan-ui/single-image-upload';

@Component({
  selector: 'lib-spartan-formly-field-single-image-upload',
  imports: [ReactiveFormsModule, FormlyModule, HlmSingleImageUploadImports],
  template: `
    <hlm-single-image-upload
      [formControl]="formControl"
      [accept]="props['accept'] || 'image/png,image/jpeg,image/jpg'"
      [minSize]="props['minSize'] || 0"
      [maxSize]="props['maxSize'] || 2 * 1024 * 1024"
      [buttonText]="props['buttonText'] || 'Upload image'"
      [buttonVariant]="props['buttonVariant'] || 'default'"
      [showIcon]="props['showIcon'] ?? true"
      [emptyText]="props['emptyText'] || 'No image attached'"
    />
  `,
})
export class SpartanFormlyFieldSingleImageUpload extends FieldType<FieldTypeConfig> {}
