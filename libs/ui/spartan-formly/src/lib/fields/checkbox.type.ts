import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmCheckboxImports } from '@openbucket/spartan-ui/checkbox';

/**
 * Formly field type for Spartan Checkbox component
 *
 * Supports labels with embedded links using labelParts configuration
 */
@Component({
  selector: 'lib-spartan-formly-field-checkbox',
  imports: [ReactiveFormsModule, FormlyModule, HlmCheckboxImports, RouterLink],
  template: `
    <div class="flex items-center gap-2 mb-4">
      <hlm-checkbox
        [id]="id"
        [formControl]="formControl"
        [disabled]="props['disabled'] || false"
      />
      @if (props['label'] || props['labelParts']) {
        <label
          [for]="id"
          class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
        >
          @if (props['labelParts']) {
            <!-- Render structured label with links -->
            @for (part of props['labelParts']; track $index) {
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
            {{ props['label'] }}
          }
          @if (props['required'] && props['hideRequiredMarker'] !== true) {
            <span class="text-destructive ml-1">*</span>
          }
        </label>
      }
    </div>
  `,
})
export class SpartanFormlyFieldCheckbox extends FieldType<FieldTypeConfig> {}
