import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmRadioGroupImports } from '@openbucket/spartan-ui/radio-group';
import { BrnRadioGroupImports } from '@spartan-ng/brain/radio-group';
import { HlmLabelImports } from '@openbucket/spartan-ui/label';

/**
 * Formly field type for Spartan Radio Group component
 *
 * Supports option labels with embedded links using labelParts configuration
 */
@Component({
  selector: 'lib-spartan-formly-field-radio-group',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmRadioGroupImports,
    BrnRadioGroupImports,
    HlmLabelImports,
    RouterLink,
  ],
  template: `
    <div
      hlmRadioGroup
      [id]="id"
      [value]="formControl.value"
      (valueChange)="formControl.setValue($event)"
      [disabled]="props['disabled'] || false"
      [class]="
        props['orientation'] === 'horizontal'
          ? '!flex !flex-row gap-4'
          : '!flex !flex-col gap-3'
      "
    >
      @for (
        option of props['options'] || [];
        track option.value;
        let i = $index
      ) {
        <div class="flex items-center gap-3">
          <hlm-radio
            [value]="option.value"
            [id]="id + '-' + i"
            [disabled]="option.disabled || false"
          >
            <hlm-radio-indicator indicator />
          </hlm-radio>
          <label
            hlmLabel
            [for]="id + '-' + i"
            class="cursor-pointer"
          >
            @if (option.labelParts) {
              <!-- Render structured label with links -->
              @for (part of option.labelParts; track $index) {
                @if (part.href) {
                  <a
                    [href]="part.href"
                    [target]="part.target || '_self'"
                    [rel]="
                      part.target === '_blank' ? 'noopener noreferrer' : null
                    "
                    class="text-primary underline hover:text-primary/80"
                    (click)="$event.stopPropagation()"
                    >{{ part.text }}</a
                  >
                } @else if (part.routerLink) {
                  <a
                    [routerLink]="part.routerLink"
                    [target]="part.target || '_self'"
                    class="text-primary underline hover:text-primary/80"
                    (click)="$event.stopPropagation()"
                    >{{ part.text }}</a
                  >
                } @else {
                  <span>{{ part.text || part }}</span>
                }
              }
            } @else {
              <!-- Simple text label -->
              {{ option.label }}
            }
          </label>
        </div>
      }
    </div>
  `,
})
export class SpartanFormlyFieldRadioGroup extends FieldType<FieldTypeConfig> {}
