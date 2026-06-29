import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmSliderImports } from '@openbucket/spartan-ui/slider';
import { BrnSliderImports } from '@spartan-ng/brain/slider';

/**
 * Formly field type for Spartan Slider component
 */
@Component({
  selector: 'lib-spartan-formly-field-slider',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmSliderImports,
    BrnSliderImports,
  ],
  template: `
    <div class="space-y-2">
      <hlm-slider
        [id]="id"
        [value]="formControl.value"
        (valueChange)="formControl.setValue($event)"
        [disabled]="props['disabled'] || false"
        [min]="props['min'] || 0"
        [max]="props['max'] || 100"
        [step]="props['step'] || 1"
        class="w-full"
      />
      @if (props['showValue']) {
        <div class="text-sm text-muted-foreground text-center">
          {{ formControl.value }}
        </div>
      }
    </div>
  `,
})
export class SpartanFormlyFieldSlider extends FieldType<FieldTypeConfig> {}
