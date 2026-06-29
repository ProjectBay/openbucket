/**
 * Enum of all available Spartan UI form field types
 */
export enum SpartanFieldType {
  // Text inputs
  INPUT = 'input',
  INPUT_GROUP = 'input-group',
  TEXTAREA = 'textarea',

  // Selection
  SELECT = 'select',
  MULTISELECT = 'multiselect',
  RADIO_GROUP = 'radio-group',
  CHECKBOX = 'checkbox',
  SWITCH = 'switch',

  // Date/Time
  DATE_PICKER = 'date-picker',
  DATE_RANGE_PICKER = 'date-range-picker',

  // Advanced
  AUTOCOMPLETE = 'autocomplete',
  SLIDER = 'slider',

  // Special
  INPUT_OTP = 'input-otp',
  AVATAR_UPLOAD = 'avatar-upload',
  IMAGE_UPLOAD = 'image-upload',
  SINGLE_IMAGE_UPLOAD = 'single-image-upload',
  PROFILE_IMAGE_UPLOAD = 'profile-image-upload',
  TURNSTILE = 'turnstile',
}
