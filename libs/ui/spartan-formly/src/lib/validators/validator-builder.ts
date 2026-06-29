import { AbstractControl } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  alphabeticValidatorExpression,
  alphanumericValidatorExpression,
  creditCardValidatorExpression,
  emailValidatorExpression,
  fieldMatchValidatorExpression,
  integerValidatorExpression,
  ipv4ValidatorExpression,
  maxDateValidatorExpression,
  maxLengthValidatorExpression,
  maxValidatorExpression,
  minDateValidatorExpression,
  minLengthValidatorExpression,
  minValidatorExpression,
  numericValidatorExpression,
  patternValidatorExpression,
  phoneValidatorExpression,
  urlValidatorExpression,
} from './validators';

/**
 * Validator configuration interface
 */
export interface ValidatorConfig {
  expression: (c: AbstractControl) => boolean;
  message?: string | ((error: any, field: FormlyFieldConfig) => string);
}

/**
 * Validator builder for creating Formly validators with transloco support
 *
 * Usage:
 * ```typescript
 * validators: {
 *   ...ValidatorBuilder.email(),
 *   ...ValidatorBuilder.minLength(5),
 * }
 * ```
 */
export class ValidatorBuilder {
  /**
   * Email validator
   */
  static email(): Record<string, ValidatorConfig> {
    return {
      email: {
        expression: emailValidatorExpression,
      },
    };
  }

  /**
   * URL validator
   */
  static url(): Record<string, ValidatorConfig> {
    return {
      url: {
        expression: urlValidatorExpression,
      },
    };
  }

  /**
   * Min length validator
   * @param minLength - Minimum length required
   * Note: Also set `minlength` in field props for translation parameter interpolation
   */
  static minLength(minLength: number): Record<string, ValidatorConfig> {
    return {
      minlength: {
        expression: minLengthValidatorExpression(minLength),
      },
    };
  }

  /**
   * Max length validator
   * @param maxLength - Maximum length allowed
   * Note: Also set `maxlength` in field props for translation parameter interpolation
   */
  static maxLength(maxLength: number): Record<string, ValidatorConfig> {
    return {
      maxlength: {
        expression: maxLengthValidatorExpression(maxLength),
      },
    };
  }

  /**
   * Min value validator
   * @param min - Minimum value required
   * Note: Also set `min` in field props for translation parameter interpolation
   */
  static min(min: number): Record<string, ValidatorConfig> {
    return {
      min: {
        expression: minValidatorExpression(min),
      },
    };
  }

  /**
   * Max value validator
   * @param max - Maximum value allowed
   * Note: Also set `max` in field props for translation parameter interpolation
   */
  static max(max: number): Record<string, ValidatorConfig> {
    return {
      max: {
        expression: maxValidatorExpression(max),
      },
    };
  }

  /**
   * Pattern validator
   * @param pattern - Regex pattern to match
   * @param customMessage - Optional custom message (transloco key or function)
   */
  static pattern(
    pattern: string | RegExp,
    customMessage?: string | ((error: any, field: FormlyFieldConfig) => string),
  ): Record<string, ValidatorConfig> {
    const config: ValidatorConfig = {
      expression: patternValidatorExpression(pattern),
    };
    if (customMessage) {
      config.message = customMessage;
    }
    return {
      pattern: config,
    };
  }

  /**
   * Phone validator
   */
  static phone(): Record<string, ValidatorConfig> {
    return {
      phone: {
        expression: phoneValidatorExpression,
      },
    };
  }

  /**
   * Numeric validator - only allows numbers
   */
  static numeric(): Record<string, ValidatorConfig> {
    return {
      numeric: {
        expression: numericValidatorExpression,
      },
    };
  }

  /**
   * Integer validator - only allows integers
   */
  static integer(): Record<string, ValidatorConfig> {
    return {
      integer: {
        expression: integerValidatorExpression,
      },
    };
  }

  /**
   * Alphanumeric validator - letters and numbers only
   */
  static alphanumeric(): Record<string, ValidatorConfig> {
    return {
      alphanumeric: {
        expression: alphanumericValidatorExpression,
      },
    };
  }

  /**
   * Alphabetic validator - letters only
   */
  static alphabetic(): Record<string, ValidatorConfig> {
    return {
      alphabetic: {
        expression: alphabeticValidatorExpression,
      },
    };
  }

  /**
   * IPv4 address validator
   */
  static ipv4(): Record<string, ValidatorConfig> {
    return {
      ipv4: {
        expression: ipv4ValidatorExpression,
      },
    };
  }

  /**
   * Credit card validator (Luhn algorithm)
   */
  static creditCard(): Record<string, ValidatorConfig> {
    return {
      creditCard: {
        expression: creditCardValidatorExpression,
      },
    };
  }

  /**
   * Min date validator
   * @param minDate - Minimum date allowed
   */
  static minDate(minDate: Date): Record<string, ValidatorConfig> {
    return {
      minDate: {
        expression: minDateValidatorExpression(minDate),
      },
    };
  }

  /**
   * Max date validator
   * @param maxDate - Maximum date allowed
   */
  static maxDate(maxDate: Date): Record<string, ValidatorConfig> {
    return {
      maxDate: {
        expression: maxDateValidatorExpression(maxDate),
      },
    };
  }

  /**
   * Field match validator - useful for password confirmation
   * @param fieldToMatch - The field key to match against
   * @param customMessage - Optional custom message (transloco key or function)
   */
  static fieldMatch(
    fieldToMatch: string,
    customMessage?: string | ((error: any, field: FormlyFieldConfig) => string),
  ): Record<string, ValidatorConfig> {
    const config: ValidatorConfig = {
      expression: fieldMatchValidatorExpression(fieldToMatch),
    };
    if (customMessage) {
      config.message = customMessage;
    }
    return {
      fieldMatch: config,
    };
  }

  /**
   * Custom validator
   * @param name - Validator name
   * @param expression - Validator expression
   * @param message - Optional error message (transloco key or function)
   */
  static custom(
    name: string,
    expression: (c: AbstractControl) => boolean,
    message?: string | ((error: any, field: FormlyFieldConfig) => string),
  ): Record<string, ValidatorConfig> {
    const config: ValidatorConfig = { expression };
    if (message) {
      config.message = message;
    }
    return {
      [name]: config,
    };
  }

  /**
   * Combine multiple validators
   * @param validators - Array of validator configs
   */
  static combine(
    ...validators: Record<string, ValidatorConfig>[]
  ): Record<string, ValidatorConfig> {
    return Object.assign({}, ...validators);
  }
}
