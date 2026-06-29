import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { HlmProfileImageUploadImports } from '@openbucket/spartan-ui/profile-image-upload';

@Component({
  selector: 'lib-spartan-formly-field-profile-image-upload',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    TranslateModule,
    HlmProfileImageUploadImports,
  ],
  template: `
    <hlm-profile-image-upload
      [formControl]="formControl"
      [userName]="props['userName'] || ''"
      [accept]="props['accept'] || 'image/png,image/jpeg,image/jpg,image/gif'"
      [minSize]="props['minSize'] || 0"
      [maxSize]="props['maxSize'] || 5 * 1024 * 1024"
      [size]="props['size'] || 'lg'"
      [showRemoveButton]="props['showRemoveButton'] ?? true"
      [showCameraBadge]="props['showCameraBadge'] ?? true"
      [changeText]="(props['changeText'] || 'Change') | translate"
      [uploadText]="(props['uploadText'] || 'Upload') | translate"
      [dropText]="(props['dropText'] || 'Drop here') | translate"
      [originalImageUrl]="props['originalImageUrl'] || null"
      [tabsVariant]="props['tabsVariant'] || 'default'"
    />
  `,
})
export class SpartanFormlyFieldProfileImageUpload extends FieldType<FieldTypeConfig> {}
