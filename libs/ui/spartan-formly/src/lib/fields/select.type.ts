import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { BrnSelectImports } from '@spartan-ng/brain/select';

/**
 * Formly field type for Spartan Select component
 * Supports both flat options and grouped options with scrollable mode
 */
@Component({
  selector: 'lib-spartan-formly-field-select',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmSelectImports,
    BrnSelectImports,
  ],
  template: `
    <hlm-select
      [id]="id"
      [formControl]="formControl"
      [placeholder]="props['placeholder'] || 'Select an option'"
      [disabled]="props['disabled'] || false"
      [multiple]="props['multiple'] || false"
      [attr.scrollable]="props['scrollable'] ? 'true' : null"
    >
      <hlm-select-trigger [class]="props['triggerClass'] || 'w-full'">
        <hlm-select-value />
      </hlm-select-trigger>
      <hlm-select-content [class]="props['contentClass']">
        @if (props['scrollable']) {
          <hlm-select-scroll-up />
        }

        @if (isGroupedOptions()) {
          @for (group of props['options'] || []; track group.label) {
            <hlm-select-group>
              <hlm-select-label>{{ group.label }}</hlm-select-label>
              @for (option of group.options || []; track option.value) {
                <hlm-option
                  [value]="option.value"
                  [disabled]="option.disabled || false"
                >
                  {{ option.label }}
                </hlm-option>
              }
            </hlm-select-group>
          }
        } @else {
          @for (option of props['options'] || []; track option.value) {
            <hlm-option
              [value]="option.value"
              [disabled]="option.disabled || false"
            >
              {{ option.label }}
            </hlm-option>
          }
        }

        @if (props['scrollable']) {
          <hlm-select-scroll-down />
        }
      </hlm-select-content>
    </hlm-select>
  `,
})
export class SpartanFormlyFieldSelect extends FieldType<FieldTypeConfig> {
  isGroupedOptions(): boolean {
    const options = this.props['options'];
    return (
      Array.isArray(options) && options.length > 0 && 'options' in options[0]
    );
  }
}
