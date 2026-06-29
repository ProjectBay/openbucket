import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmImageUploadImports } from '@openbucket/spartan-ui/image-upload';

@Component({
  selector: 'lib-spartan-formly-field-image-upload',
  imports: [ReactiveFormsModule, FormlyModule, HlmImageUploadImports],
  template: `
    <hlm-image-upload
      [formControl]="formControl"
      [accept]="props['accept'] || 'image/png,image/jpeg,image/jpg'"
      [minSize]="props['minSize'] || 0"
      [maxSize]="props['maxSize'] || 2 * 1024 * 1024"
      [maxTotalSize]="props['maxTotalSize'] || 10 * 1024 * 1024"
      [minCount]="props['minCount'] || 0"
      [maxCount]="props['maxCount']"
      [uploadTitle]="props['uploadTitle'] || ''"
      [uploadHint]="props['uploadHint'] || ''"
      [browseButtonText]="props['browseButtonText'] || 'Browse File'"
      [showExamples]="props['showExamples'] ?? true"
    />
  `,
})
export class SpartanFormlyFieldImageUpload extends FieldType<FieldTypeConfig> {}
