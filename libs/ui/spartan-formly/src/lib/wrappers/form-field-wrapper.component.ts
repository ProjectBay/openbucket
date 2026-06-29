import { Component } from '@angular/core';
import { FieldWrapper, FormlyModule } from '@ngx-formly/core';
import { HlmFieldImports } from '@openbucket/spartan-ui/field';
import { HlmTooltipImports } from '@openbucket/spartan-ui/tooltip';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { provideIcons } from '@ng-icons/core';
import { lucideCircleHelp } from '@ng-icons/lucide';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';

/**
 * Wrapper component that provides label, hint, and error display for form fields
 * Uses Spartan UI's field system which works with all control types
 *
 * Supports optional tooltip that displays a "?" icon next to the label
 */
@Component({
  selector: 'lib-spartan-formly-wrapper-form-field',
  imports: [
    FormlyModule,
    HlmFieldImports,
    HlmTooltipImports,
    HlmIconImports,
    BrnTooltipImports,
  ],
  providers: [provideIcons({ lucideCircleHelp })],
  template: `
    <div
      hlmField
      class="mb-4"
    >
      <!-- Label -->
      @if (props['label']) {
        <label
          hlmFieldLabel
          [for]="id"
          class="inline-flex items-center gap-1.5"
        >
          <!-- Tooltip Icon -->
          @if (props['tooltip']) {
            <hlm-tooltip>
              <button
                hlmTooltipTrigger
                aria-describedby="Hello world"
                hlmBtn
                variant="outline"
                class="translate-y-[calc(2px)]"
              >
                <ng-icon
                  name="lucideCircleHelp"
                  size="14"
                />
              </button>

              <span
                *brnTooltipContent
                class="flex items-center"
              >
                {{ props['tooltip'] }}
              </span>
            </hlm-tooltip>
          }

          <span>
            {{ props['label'] }}
            @if (props['required'] && props['hideRequiredMarker'] !== true) {
              <span class="text-destructive ml-1">*</span>
            }
          </span>
        </label>
      }

      <!-- Field Content -->
      <ng-container #fieldComponent></ng-container>

      <!-- Hint/Description -->
      @if ((props['hint'] || props['description']) && !showError) {
        <p hlmFieldDescription>
          {{ props['hint'] || props['description'] }}
        </p>
      }

      <!-- Error Messages -->
      @if (showError) {
        <div
          animate.enter="enter-animation"
          animate.leave="leave-animation"
        >
          <p
            hlmFieldDescription
            class="text-destructive"
          >
            <formly-validation-message
              [field]="field"
            ></formly-validation-message>
          </p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .enter-animation {
        animation: slide-fade 100ms ease-out;
      }
      @keyframes slide-fade {
        from {
          opacity: 0;
          height: 0px;
          transform: translateY(-20px);
        }
        to {
          opacity: 1;
          height: 21px;
          transform: translateY(0);
        }
      }

      .leave-animation {
        animation: slide-fade-leave 100ms ease-out;
      }
      @keyframes slide-fade-leave {
        from {
          opacity: 1;
          height: 21px;
          transform: translateY(0px);
        }
        to {
          opacity: 0;
          height: 0px;
          transform: translateY(-20px);
        }
      }
    `,
  ],
})
export class SpartanFormFieldWrapperComponent extends FieldWrapper {
  override get showError(): boolean {
    return !!(
      this.field.formControl &&
      this.field.formControl.invalid &&
      this.field.formControl.touched
    );
  }
}
