import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmAvatarUploadImports } from '@openbucket/spartan-ui/avatar';

@Component({
  selector: 'lib-spartan-formly-field-avatar-upload',
  imports: [ReactiveFormsModule, FormlyModule, HlmAvatarUploadImports],
  template: `
    <hlm-avatar-upload
      [formControl]="formControl"
      [alt]="props['alt'] || 'Avatar'"
      [accept]="props['accept'] || 'image/png,image/jpeg,image/jpg'"
      [minSize]="props['minSize'] || 0"
      [maxSize]="props['maxSize'] || 2 * 1024 * 1024"
      [size]="props['size'] || 'default'"
      [showRemoveButton]="props['showRemoveButton'] ?? true"
      [uploadText]="props['uploadText'] || ''"
      [uploadHint]="props['uploadHint'] || ''"
      [initials]="props['initials'] || ''"
    />
  `,
})
export class SpartanFormlyFieldAvatarUpload extends FieldType<FieldTypeConfig> {}
