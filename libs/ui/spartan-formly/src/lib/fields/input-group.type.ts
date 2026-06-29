import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmInputGroupImports } from '@openbucket/spartan-ui/input-group';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmTooltipImports } from '@openbucket/spartan-ui/tooltip';
import { HlmSpinnerImports } from '@openbucket/spartan-ui/spinner';
import { provideIcons } from '@ng-icons/core';
import * as allLucideIcons from '@ng-icons/lucide';

/**
 * Formly field type for Spartan Input Group component
 * Supports inputs/textareas with prefix/suffix text, icons, buttons, and spinners
 */
@Component({
  selector: 'lib-spartan-formly-field-input-group',
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmInputGroupImports,
    HlmIconImports,
    HlmTooltipImports,
    HlmSpinnerImports,
  ],
  providers: [provideIcons(allLucideIcons)],
  template: `
    <div
      hlmInputGroup
      [class]="props['groupClass'] || ''"
      [attr.data-disabled]="
        props['prefixSpinner'] || props['suffixSpinner'] ? 'true' : null
      "
    >
      @if (props['isTextarea']) {
        <!-- Textarea Layout -->

        <!-- Top Addon (block-start) -->
        @if (
          props['prefixText'] ||
          props['prefixIcon'] ||
          props['prefixButton'] ||
          props['topButtons']
        ) {
          <div
            hlmInputGroupAddon
            align="block-start"
            class="border-b"
          >
            @if (props['prefixText']) {
              <span
                hlmInputGroupText
                class="font-mono font-medium"
              >
                @if (props['prefixIcon']) {
                  <ng-icon [name]="props['prefixIcon']" />
                }
                {{ props['prefixText'] }}
              </span>
            } @else if (props['prefixIcon']) {
              <ng-icon [name]="props['prefixIcon']" />
            }

            @if (props['topButtons']) {
              @for (button of props['topButtons']; track $index) {
                <button
                  hlmInputGroupButton
                  type="button"
                  [variant]="button.variant || 'ghost'"
                  [size]="button.size || 'icon-xs'"
                  [hlmTooltipTrigger]="button.tooltip || null"
                  [attr.aria-label]="button.label || 'Button'"
                  [class.ml-auto]="$index === 0"
                  (click)="button.onClick?.()"
                >
                  @if (button.icon) {
                    <ng-icon [name]="button.icon" />
                  }
                  @if (button.text) {
                    {{ button.text }}
                  }
                </button>
              }
            } @else if (props['prefixButton']) {
              <button
                hlmInputGroupButton
                type="button"
                [variant]="props['prefixButton'].variant || 'ghost'"
                [size]="props['prefixButton'].size || 'icon-xs'"
                [hlmTooltipTrigger]="props['prefixButton'].tooltip || null"
                [attr.aria-label]="props['prefixButton'].label || 'Button'"
                class="ml-auto"
                (click)="props['prefixButton'].onClick?.()"
              >
                @if (props['prefixButton'].icon) {
                  <ng-icon [name]="props['prefixButton'].icon" />
                }
                @if (props['prefixButton'].text) {
                  {{ props['prefixButton'].text }}
                }
              </button>
            }
          </div>
        }

        <!-- Textarea -->
        <textarea
          hlmInputGroupTextarea
          [id]="id"
          [formControl]="formControl"
          [placeholder]="props['placeholder'] || ''"
          [readonly]="props['readonly'] || false"
          [attr.rows]="props['rows']"
          [attr.maxlength]="props['maxlength']"
          [attr.minlength]="props['minlength']"
          [class]="props['textareaMinHeight'] || 'min-h-[200px]'"
        ></textarea>

        <!-- Bottom Addon (block-end) -->
        @if (
          props['suffixText'] || props['suffixButton'] || props['bottomButtons']
        ) {
          <div
            hlmInputGroupAddon
            align="block-end"
            class="border-t"
          >
            @if (props['suffixText']) {
              <span hlmInputGroupText>{{ props['suffixText'] }}</span>
            }

            @if (props['bottomButtons']) {
              @for (button of props['bottomButtons']; track $index) {
                <button
                  hlmInputGroupButton
                  type="button"
                  [variant]="button.variant || 'default'"
                  [size]="button.size || 'sm'"
                  [hlmTooltipTrigger]="button.tooltip || null"
                  [attr.aria-label]="button.label || 'Button'"
                  [class.ml-auto]="$index === 0"
                  (click)="button.onClick?.()"
                >
                  @if (button.text) {
                    {{ button.text }}
                  }
                  @if (button.icon) {
                    <ng-icon [name]="button.icon" />
                  }
                </button>
              }
            } @else if (props['suffixButton']) {
              <button
                hlmInputGroupButton
                type="button"
                [variant]="props['suffixButton'].variant || 'default'"
                [size]="props['suffixButton'].size || 'sm'"
                [hlmTooltipTrigger]="props['suffixButton'].tooltip || null"
                [attr.aria-label]="props['suffixButton'].label || 'Button'"
                class="ml-auto"
                (click)="props['suffixButton'].onClick?.()"
              >
                @if (props['suffixButton'].text) {
                  {{ props['suffixButton'].text }}
                }
                @if (props['suffixButton'].icon) {
                  <ng-icon [name]="props['suffixButton'].icon" />
                }
              </button>
            }
          </div>
        }
      } @else {
        <!-- Input Layout -->

        <!-- Prefix Addon -->
        @if (
          props['prefixText'] ||
          props['prefixIcon'] ||
          props['prefixButton'] ||
          props['prefixSpinner']
        ) {
          <div hlmInputGroupAddon>
            @if (props['prefixSpinner']) {
              @if (props['customSpinnerIcon']) {
                <ng-icon
                  [name]="props['customSpinnerIcon']"
                  class="motion-safe:animate-spin"
                />
              } @else {
                <hlm-spinner />
              }
            } @else if (props['prefixButton']) {
              <button
                hlmInputGroupButton
                type="button"
                [variant]="props['prefixButton'].variant || 'ghost'"
                [size]="props['prefixButton'].size || 'icon-xs'"
                [hlmTooltipTrigger]="props['prefixButton'].tooltip || null"
                [attr.aria-label]="props['prefixButton'].label || 'Button'"
                (click)="props['prefixButton'].onClick?.()"
              >
                @if (props['prefixButton'].icon) {
                  <ng-icon [name]="props['prefixButton'].icon" />
                }
                @if (props['prefixButton'].text) {
                  {{ props['prefixButton'].text }}
                }
              </button>
            } @else if (props['prefixIcon']) {
              <ng-icon [name]="props['prefixIcon']" />
            } @else if (props['prefixText']) {
              <span hlmInputGroupText>{{ props['prefixText'] }}</span>
            }
          </div>
        }

        <!-- Input -->
        <input
          hlmInputGroupInput
          [id]="id"
          [formControl]="formControl"
          [type]="props['inputType'] || 'text'"
          [placeholder]="props['placeholder'] || ''"
          [readonly]="props['readonly'] || false"
          [disabled]="
            props['disabled'] ||
            props['prefixSpinner'] ||
            props['suffixSpinner'] ||
            false
          "
          [attr.autocomplete]="props['autocomplete']"
          [attr.maxlength]="props['maxlength']"
          [attr.minlength]="props['minlength']"
          [attr.pattern]="props['pattern']"
        />

        <!-- Suffix Addon -->
        @if (
          props['suffixText'] ||
          props['suffixIcon'] ||
          props['suffixIcons'] ||
          props['suffixButton'] ||
          props['suffixSpinner']
        ) {
          <div
            hlmInputGroupAddon
            align="inline-end"
          >
            @if (props['suffixSpinnerText']) {
              <span hlmInputGroupText>{{ props['suffixSpinnerText'] }}</span>
            }
            @if (props['suffixSpinner']) {
              @if (props['customSpinnerIcon']) {
                <ng-icon
                  [name]="props['customSpinnerIcon']"
                  class="motion-safe:animate-spin"
                />
              } @else {
                <hlm-spinner />
              }
            } @else if (props['suffixButton']) {
              <button
                hlmInputGroupButton
                type="button"
                [variant]="props['suffixButton'].variant || 'secondary'"
                [size]="props['suffixButton'].size || 'icon-xs'"
                [hlmTooltipTrigger]="props['suffixButton'].tooltip || null"
                [attr.aria-label]="props['suffixButton'].label || 'Button'"
                (click)="props['suffixButton'].onClick?.()"
              >
                @if (props['suffixButton'].icon) {
                  <ng-icon [name]="props['suffixButton'].icon" />
                }
                @if (props['suffixButton'].text) {
                  {{ props['suffixButton'].text }}
                }
              </button>
            } @else if (props['suffixIcons']) {
              @for (icon of props['suffixIcons']; track icon) {
                <ng-icon [name]="icon" />
              }
            } @else if (props['suffixIcon']) {
              <ng-icon [name]="props['suffixIcon']" />
            } @else if (props['suffixText']) {
              <span hlmInputGroupText>{{ props['suffixText'] }}</span>
            }
          </div>
        }
      }
    </div>
  `,
})
export class SpartanFormlyFieldInputGroup extends FieldType<FieldTypeConfig> {}
