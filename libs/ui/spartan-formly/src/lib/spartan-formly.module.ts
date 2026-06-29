import { NgModule } from '@angular/core';
import { FormlyModule } from '@ngx-formly/core';
import { SPARTAN_FORMLY_CONFIG } from './spartan-formly.config';

// Import all field components
import { SpartanFormlyFieldInput } from './fields/input.type';
import { SpartanFormlyFieldTextarea } from './fields/textarea.type';
import { SpartanFormlyFieldSelect } from './fields/select.type';
import { SpartanFormlyFieldCheckbox } from './fields/checkbox.type';
import { SpartanFormlyFieldSwitch } from './fields/switch.type';
import { SpartanFormlyFieldRadioGroup } from './fields/radio-group.type';
import { SpartanFormlyFieldDatePicker } from './fields/date-picker.type';
import { SpartanFormlyFieldSlider } from './fields/slider.type';
import { SpartanFormlyFieldAutocomplete } from './fields/autocomplete.type';
import { SpartanFormlyFieldInputOtp } from './fields/input-otp.type';

// Import wrapper
import { SpartanFormFieldWrapperComponent } from './wrappers/form-field-wrapper.component';

/**
 * Module that provides Formly integration for Spartan UI components
 *
 * @example
 * ```typescript
 * import { SpartanFormlyModule } from '@openbucket/spartan-ui/formly';
 *
 * @Component({
 *   imports: [
 *     ReactiveFormsModule,
 *     FormlyModule.forRoot(),
 *     SpartanFormlyModule,
 *   ],
 * })
 * export class MyComponent {
 *   form = new FormGroup({});
 *   model = {};
 *   fields: FormlyFieldConfig[] = [
 *     {
 *       key: 'email',
 *       type: SpartanFieldType.INPUT,
 *       props: {
 *         label: 'Email',
 *         placeholder: 'Enter your email',
 *         type: 'email',
 *         required: true,
 *       },
 *     },
 *   ];
 * }
 * ```
 */
@NgModule({
  imports: [
    FormlyModule.forChild(SPARTAN_FORMLY_CONFIG),
    // Field components
    SpartanFormlyFieldInput,
    SpartanFormlyFieldTextarea,
    SpartanFormlyFieldSelect,
    SpartanFormlyFieldCheckbox,
    SpartanFormlyFieldSwitch,
    SpartanFormlyFieldRadioGroup,
    SpartanFormlyFieldDatePicker,
    SpartanFormlyFieldSlider,
    SpartanFormlyFieldAutocomplete,
    SpartanFormlyFieldInputOtp,
    // Wrapper
    SpartanFormFieldWrapperComponent,
  ],
  exports: [
    FormlyModule,
    // Field components
    SpartanFormlyFieldInput,
    SpartanFormlyFieldTextarea,
    SpartanFormlyFieldSelect,
    SpartanFormlyFieldCheckbox,
    SpartanFormlyFieldSwitch,
    SpartanFormlyFieldRadioGroup,
    SpartanFormlyFieldDatePicker,
    SpartanFormlyFieldSlider,
    SpartanFormlyFieldAutocomplete,
    SpartanFormlyFieldInputOtp,
    // Wrapper
    SpartanFormFieldWrapperComponent,
  ],
})
export class SpartanFormlyModule {}
