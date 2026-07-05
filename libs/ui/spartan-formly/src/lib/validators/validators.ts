import { AbstractControl, ValidationErrors } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';

/**
 * Standard validators for Formly fields with transloco support
 * All validators return null for empty values (use 'required' validator for that)
 */

// ============================================================================
// EMAIL VALIDATOR
// ============================================================================

/**
 * RFC 5322 compliant email regex pattern
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Email validator expression
 */
export function emailValidatorExpression(control: AbstractControl): boolean {
  return !control.value || EMAIL_REGEX.test(control.value);
}

// ============================================================================
// URL VALIDATOR
// ============================================================================

/**
 * URL regex pattern.
 *
 * The path portion is a single `[/\w .-]*` class rather than the nested
 * `([/\w .-]*)*` it replaces: the inner group could match empty, making the
 * outer `*` ambiguous and catastrophically backtrack (js/redos). A flat
 * character class accepts exactly the same strings without the nested
 * quantifier.
 */
const URL_REGEX = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})[/\w .-]*\/?$/;

/**
 * URL validator expression
 */
export function urlValidatorExpression(control: AbstractControl): boolean {
  return !control.value || URL_REGEX.test(control.value);
}

// ============================================================================
// MIN/MAX LENGTH VALIDATORS
// ============================================================================

/**
 * Min length validator expression factory
 */
export function minLengthValidatorExpression(minLength: number) {
  return (control: AbstractControl): boolean => {
    return (
      !control.value ||
      typeof control.value !== 'string' ||
      control.value.length >= minLength
    );
  };
}

/**
 * Max length validator expression factory
 */
export function maxLengthValidatorExpression(maxLength: number) {
  return (control: AbstractControl): boolean => {
    return (
      !control.value ||
      typeof control.value !== 'string' ||
      control.value.length <= maxLength
    );
  };
}

// ============================================================================
// MIN/MAX VALUE VALIDATORS
// ============================================================================

/**
 * Min value validator expression factory
 */
export function minValidatorExpression(min: number) {
  return (control: AbstractControl): boolean => {
    const value = Number(control.value);
    return !control.value || isNaN(value) || value >= min;
  };
}

/**
 * Max value validator expression factory
 */
export function maxValidatorExpression(max: number) {
  return (control: AbstractControl): boolean => {
    const value = Number(control.value);
    return !control.value || isNaN(value) || value <= max;
  };
}

// ============================================================================
// PATTERN VALIDATOR
// ============================================================================

/**
 * Pattern validator expression factory
 */
export function patternValidatorExpression(pattern: string | RegExp) {
  return (control: AbstractControl): boolean => {
    if (!control.value) return true;
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return regex.test(control.value);
  };
}

// ============================================================================
// PHONE VALIDATOR
// ============================================================================

/**
 * International phone number regex pattern
 * Matches formats like: +1-234-567-8900, (123) 456-7890, 123-456-7890
 */
const PHONE_REGEX =
  /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;

/**
 * Phone validator expression
 */
export function phoneValidatorExpression(control: AbstractControl): boolean {
  return !control.value || PHONE_REGEX.test(control.value);
}

// ============================================================================
// NUMERIC VALIDATORS
// ============================================================================

/**
 * Numeric validator expression - only allows numbers
 */
export function numericValidatorExpression(control: AbstractControl): boolean {
  return !control.value || !isNaN(Number(control.value));
}

/**
 * Integer validator expression - only allows integers
 */
export function integerValidatorExpression(control: AbstractControl): boolean {
  return !control.value || Number.isInteger(Number(control.value));
}

// ============================================================================
// ALPHANUMERIC VALIDATORS
// ============================================================================

/**
 * Alphanumeric validator expression - letters and numbers only
 */
export function alphanumericValidatorExpression(
  control: AbstractControl,
): boolean {
  return !control.value || /^[a-zA-Z0-9]*$/.test(control.value);
}

/**
 * Alphabetic validator expression - letters only
 */
export function alphabeticValidatorExpression(
  control: AbstractControl,
): boolean {
  return !control.value || /^[a-zA-Z]*$/.test(control.value);
}

// ============================================================================
// IP ADDRESS VALIDATOR
// ============================================================================

/**
 * IPv4 address validator expression
 */
export function ipv4ValidatorExpression(control: AbstractControl): boolean {
  return !control.value || /^(\d{1,3}\.){3}\d{1,3}$/.test(control.value);
}

// ============================================================================
// CREDIT CARD VALIDATOR
// ============================================================================

/**
 * Credit card validator using Luhn algorithm
 */
export function creditCardValidatorExpression(
  control: AbstractControl,
): boolean {
  if (!control.value) return true;

  const value = control.value.replace(/\s/g, '');
  if (!/^\d+$/.test(value)) return false;

  // Luhn algorithm
  let sum = 0;
  let isEven = false;

  for (let i = value.length - 1; i >= 0; i--) {
    let digit = parseInt(value.charAt(i), 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

// ============================================================================
// DATE VALIDATORS
// ============================================================================

/**
 * Min date validator expression factory
 */
export function minDateValidatorExpression(minDate: Date) {
  return (control: AbstractControl): boolean => {
    if (!control.value) return true;
    const date = new Date(control.value);
    return date >= minDate;
  };
}

/**
 * Max date validator expression factory
 */
export function maxDateValidatorExpression(maxDate: Date) {
  return (control: AbstractControl): boolean => {
    if (!control.value) return true;
    const date = new Date(control.value);
    return date <= maxDate;
  };
}

// ============================================================================
// CUSTOM MATCH VALIDATOR
// ============================================================================

/**
 * Field match validator expression factory
 * Useful for password confirmation fields
 */
export function fieldMatchValidatorExpression(fieldToMatch: string) {
  return (control: AbstractControl): boolean => {
    const parent = control.parent;
    if (!parent || !control.value) return true;
    const matchControl = parent.get(fieldToMatch);
    return matchControl ? control.value === matchControl.value : true;
  };
}
