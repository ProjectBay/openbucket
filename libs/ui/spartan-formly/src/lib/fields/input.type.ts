import { Component, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { HlmInputImports } from '@openbucket/spartan-ui/input';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { provideIcons } from '@ng-icons/core';
import { lucideEye, lucideEyeOff } from '@ng-icons/lucide';

/**
 * Formly field type for Spartan Input component
 * Supports password visibility toggle with eye icon
 */
@Component({
  selector: 'lib-spartan-formly-field-input',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormlyModule,
    HlmInputImports,
    HlmButtonImports,
    HlmIconImports,
  ],
  providers: [provideIcons({ lucideEye, lucideEyeOff })],
  template: `
    <div class="relative">
      <input
        hlmInput
        [id]="id"
        [type]="isPassword ? currentType() : props['type'] || 'text'"
        [formControl]="formControl"
        [formlyAttributes]="field"
        [placeholder]="props['placeholder'] || ''"
        [readonly]="props['readonly'] || false"
        [attr.autocomplete]="props['autocomplete']"
        [attr.maxlength]="props['maxlength']"
        [attr.minlength]="props['minlength']"
        [attr.pattern]="props['pattern']"
        [class]="isPassword ? 'w-full pr-10' : 'w-full'"
      />

      @if (isPassword) {
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon"
          class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
          (click)="togglePasswordVisibility()"
          [attr.aria-label]="
            currentType() === 'password' ? 'Show password' : 'Hide password'
          "
        >
          <ng-icon
            hlm
            size="sm"
            [name]="currentType() === 'password' ? 'lucideEye' : 'lucideEyeOff'"
            class="h-4 w-4 text-muted-foreground"
          />
        </button>
      }
    </div>
  `,
})
export class SpartanFormlyFieldInput extends FieldType<FieldTypeConfig> {
  protected readonly currentType = signal<'password' | 'text'>('password');

  protected get isPassword(): boolean {
    return this.props['type'] === 'password';
  }

  protected togglePasswordVisibility(): void {
    this.currentType.update((type) =>
      type === 'password' ? 'text' : 'password',
    );
  }
}
