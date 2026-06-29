import { ConfigOption } from '@ngx-formly/core';
import { SpartanFieldType } from './types/field-types.enum';
import { SpartanFormFieldWrapperComponent } from './wrappers/form-field-wrapper.component';
import { SpartanFormlyFieldsetWrapperComponent } from './wrappers/fieldset-wrapper.component';
import { SpartanFormlyFieldGroupWrapperComponent } from './wrappers/field-group-wrapper.component';
import { SpartanFormlySeparatorWrapperComponent } from './wrappers/separator-wrapper.component';
import { SpartanFormlyFieldInput } from './fields/input.type';
import { SpartanFormlyFieldInputGroup } from './fields/input-group.type';
import { SpartanFormlyFieldTextarea } from './fields/textarea.type';
import { SpartanFormlyFieldSelect } from './fields/select.type';
import { SpartanFormlyFieldMultiselect } from './fields/multiselect.type';
import { SpartanFormlyFieldCheckbox } from './fields/checkbox.type';
import { SpartanFormlyFieldSwitch } from './fields/switch.type';
import { SpartanFormlyFieldRadioGroup } from './fields/radio-group.type';
import { SpartanFormlyFieldDatePicker } from './fields/date-picker.type';
import { SpartanFormlyFieldDateRangePicker } from './fields/date-range-picker.type';
import { SpartanFormlyFieldSlider } from './fields/slider.type';
import { SpartanFormlyFieldAutocomplete } from './fields/autocomplete.type';
import { SpartanFormlyFieldInputOtp } from './fields/input-otp.type';
import { SpartanFormlyFieldAvatarUpload } from './fields/avatar-upload.type';
import { SpartanFormlyFieldImageUpload } from './fields/image-upload.type';
import { SpartanFormlyFieldSingleImageUpload } from './fields/single-image-upload.type';
import { SpartanFormlyFieldProfileImageUpload } from './fields/profile-image-upload.type';

/**
 * Formly configuration for Spartan UI components
 */
export const SPARTAN_FORMLY_CONFIG: ConfigOption = {
  types: [
    {
      name: SpartanFieldType.INPUT,
      component: SpartanFormlyFieldInput,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.INPUT_GROUP,
      component: SpartanFormlyFieldInputGroup,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.TEXTAREA,
      component: SpartanFormlyFieldTextarea,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.SELECT,
      component: SpartanFormlyFieldSelect,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.MULTISELECT,
      component: SpartanFormlyFieldMultiselect,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.CHECKBOX,
      component: SpartanFormlyFieldCheckbox,
      // Checkbox doesn't use the standard wrapper as it has its own label
    },
    {
      name: SpartanFieldType.SWITCH,
      component: SpartanFormlyFieldSwitch,
      // Switch doesn't use the standard wrapper as it has its own label
    },
    {
      name: SpartanFieldType.RADIO_GROUP,
      component: SpartanFormlyFieldRadioGroup,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.DATE_PICKER,
      component: SpartanFormlyFieldDatePicker,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.DATE_RANGE_PICKER,
      component: SpartanFormlyFieldDateRangePicker,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.SLIDER,
      component: SpartanFormlyFieldSlider,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.AUTOCOMPLETE,
      component: SpartanFormlyFieldAutocomplete,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.INPUT_OTP,
      component: SpartanFormlyFieldInputOtp,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.AVATAR_UPLOAD,
      component: SpartanFormlyFieldAvatarUpload,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.IMAGE_UPLOAD,
      component: SpartanFormlyFieldImageUpload,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.SINGLE_IMAGE_UPLOAD,
      component: SpartanFormlyFieldSingleImageUpload,
      wrappers: ['form-field'],
    },
    {
      name: SpartanFieldType.PROFILE_IMAGE_UPLOAD,
      component: SpartanFormlyFieldProfileImageUpload,
      wrappers: ['form-field'],
    },
  ],
  wrappers: [
    {
      name: 'form-field',
      component: SpartanFormFieldWrapperComponent,
    },
    {
      name: 'fieldset',
      component: SpartanFormlyFieldsetWrapperComponent,
    },
    {
      name: 'fieldGroup',
      component: SpartanFormlyFieldGroupWrapperComponent,
    },
    {
      name: 'separator',
      component: SpartanFormlySeparatorWrapperComponent,
    },
  ],
};
