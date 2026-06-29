import { AbstractControl, ValidationErrors } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Email validator for Formly fields with transloco support
 * Validates email format using a comprehensive regex pattern
 *
 * Usage:
 * {
 *   key: 'email',
 *   type: 'input',
 *   validators: {
 *     email: {
 *       expression: (c: AbstractControl) => emailValidator(c),
 *       message: (error: any, field: FormlyFieldConfig) => 'validation.email',
 *     },
 *   },
 * }
 */

/**
 * RFC 5322 compliant email regex pattern
 * Validates most common email formats
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Email validator function
 * @param control - The form control to validate
 * @returns ValidationErrors if invalid, null if valid
 */
export function emailValidator(
  control: AbstractControl,
): ValidationErrors | null {
  if (!control.value) {
    return null; // Don't validate empty values (use 'required' validator for that)
  }

  const isValid = EMAIL_REGEX.test(control.value);
  return isValid ? null : { email: true };
}

/**
 * Formly email validator configuration
 * Use this in your formly field config
 */
export function emailValidatorConfig(field: FormlyFieldConfig) {
  return {
    expression: (c: AbstractControl) => emailValidator(c),
    message: 'validation.email', // Transloco key
  };
}
