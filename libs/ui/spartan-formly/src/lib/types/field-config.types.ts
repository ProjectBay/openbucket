import { FormlyFieldConfig } from '@ngx-formly/core';
import { SpartanFieldType } from './field-types.enum';

/**
 * Label part for creating labels with embedded links
 */
export interface LabelPart {
  /** Plain text content */
  text?: string;
  /** External link URL */
  href?: string;
  /** Angular router link */
  routerLink?: unknown[] | string;
  /** Link target (_blank, _self, etc.) */
  target?: string;
}

/**
 * Base template options for all Spartan fields
 */
export interface SpartanBaseTemplateOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  hint?: string;
  tooltip?: string;
  required?: boolean;
  disabled?: boolean;
  readonly?: boolean;

  // Fieldset wrapper props (when using 'fieldset' wrapper)
  fieldsetLegend?: string;
  fieldsetDescription?: string;
  fieldsetSeparator?: boolean;
}

/**
 * Template options for Input field
 */
export interface SpartanInputTemplateOptions
  extends SpartanBaseTemplateOptions {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
  autocomplete?: string;
  maxlength?: number;
  minlength?: number;
  pattern?: string;
}

/**
 * Template options for Input Group field
 * Allows inputs/textareas with prefix/suffix text, icons, or buttons
 */
export interface SpartanInputGroupTemplateOptions
  extends SpartanBaseTemplateOptions {
  /** Whether to use textarea instead of input */
  isTextarea?: boolean;
  /** Input type (only applies if isTextarea is false) */
  inputType?:
    | 'text'
    | 'email'
    | 'password'
    | 'number'
    | 'tel'
    | 'url'
    | 'search';
  /** Minimum height for textarea (e.g., 'min-h-[200px]') */
  textareaMinHeight?: string;
  /** Rows for textarea */
  rows?: number;
  /** Text to show as prefix (e.g., '$', 'https://') */
  prefixText?: string;
  /** Text to show as suffix (e.g., 'USD', '.com') */
  suffixText?: string;
  /** Icon name to show as prefix (e.g., 'lucideSearch') */
  prefixIcon?: string;
  /** Icon name to show as suffix (e.g., 'lucideCheck') */
  suffixIcon?: string;
  /** Additional icons to show as suffix (array of icon names) */
  suffixIcons?: string[];
  /** Button configuration for prefix - positioned at top for textareas */
  prefixButton?: {
    icon?: string;
    text?: string;
    label?: string;
    variant?:
      | 'default'
      | 'destructive'
      | 'outline'
      | 'secondary'
      | 'ghost'
      | 'link';
    size?: 'sm' | 'icon-xs';
    tooltip?: string;
    onClick?: () => void;
  };
  /** Button configuration for suffix - positioned at bottom for textareas */
  suffixButton?: {
    icon?: string;
    text?: string;
    label?: string;
    variant?:
      | 'default'
      | 'destructive'
      | 'outline'
      | 'secondary'
      | 'ghost'
      | 'link';
    size?: 'sm' | 'icon-xs';
    tooltip?: string;
    onClick?: () => void;
  };
  /** Additional buttons for top addon (textareas only) */
  topButtons?: Array<{
    icon?: string;
    text?: string;
    label?: string;
    variant?:
      | 'default'
      | 'destructive'
      | 'outline'
      | 'secondary'
      | 'ghost'
      | 'link';
    size?: 'sm' | 'icon-xs';
    tooltip?: string;
    onClick?: () => void;
  }>;
  /** Additional buttons for bottom addon (textareas only) */
  bottomButtons?: Array<{
    icon?: string;
    text?: string;
    label?: string;
    variant?:
      | 'default'
      | 'destructive'
      | 'outline'
      | 'secondary'
      | 'ghost'
      | 'link';
    size?: 'sm' | 'icon-xs';
    tooltip?: string;
    onClick?: () => void;
  }>;
  /** Show spinner in prefix addon */
  prefixSpinner?: boolean;
  /** Show spinner in suffix addon */
  suffixSpinner?: boolean;
  /** Text to show with prefix spinner */
  prefixSpinnerText?: string;
  /** Text to show with suffix spinner */
  suffixSpinnerText?: string;
  /** Custom icon for spinner (e.g., 'lucideLoader') - will be animated */
  customSpinnerIcon?: string;
  /** CSS class for custom radius (e.g., '[--radius:9999px]' for rounded) */
  groupClass?: string;
}

/**
 * Template options for Textarea field
 */
export interface SpartanTextareaTemplateOptions
  extends SpartanBaseTemplateOptions {
  rows?: number;
  cols?: number;
  maxlength?: number;
  minlength?: number;
  resize?: 'none' | 'both' | 'horizontal' | 'vertical';
}

/**
 * Template options for Select field
 * Supports both flat options and grouped options with scrollable mode
 */
export interface SpartanSelectTemplateOptions
  extends SpartanBaseTemplateOptions {
  options:
    | Array<{ label: string; value: unknown; disabled?: boolean }>
    | Array<{
        label: string;
        options: Array<{ label: string; value: unknown; disabled?: boolean }>;
      }>;
  multiple?: boolean;
  searchable?: boolean;
  scrollable?: boolean;
  triggerClass?: string;
  contentClass?: string;
}

/**
 * Template options for Multiselect field with chips display
 */
export interface SpartanMultiselectTemplateOptions
  extends SpartanBaseTemplateOptions {
  options: Array<{ label: string; value: unknown; disabled?: boolean }>;
  dropdownLabel?: string;
}

/**
 * Radio group option with support for embedded links in labels
 */
export interface RadioGroupOption {
  /** Simple text label */
  label?: string;
  /** Structured label with embedded links */
  labelParts?: Array<LabelPart | string>;
  /** Option value */
  value: unknown;
  /** Whether the option is disabled */
  disabled?: boolean;
}

/**
 * Template options for Radio Group field
 */
export interface SpartanRadioGroupTemplateOptions
  extends SpartanBaseTemplateOptions {
  options: Array<RadioGroupOption>;
  orientation?: 'horizontal' | 'vertical';
}

/**
 * Template options for Checkbox field
 * Supports embedded links in labels using labelParts
 */
export interface SpartanCheckboxTemplateOptions
  extends SpartanBaseTemplateOptions {
  /** Structured label with embedded links */
  labelParts?: Array<LabelPart | string>;
  indeterminate?: boolean;
}

/**
 * Template options for Switch field
 */
export interface SpartanSwitchTemplateOptions
  extends SpartanBaseTemplateOptions {
  switchLabel?: string;
}

/**
 * Template options for Date Picker field
 */
export interface SpartanDatePickerTemplateOptions
  extends SpartanBaseTemplateOptions {
  minDate?: Date;
  maxDate?: Date;
  format?: string;
}

/**
 * Template options for Date Range Picker field
 */
export interface SpartanDateRangePickerTemplateOptions
  extends SpartanBaseTemplateOptions {
  minDate?: Date;
  maxDate?: Date;
  autoCloseOnEndSelection?: boolean;
}

/**
 * Template options for Autocomplete field
 * Supports both static and async options with custom transform functions
 */
export interface SpartanAutocompleteTemplateOptions
  extends SpartanBaseTemplateOptions {
  /** Static options array (for simple use cases) */
  options?: unknown[];
  /** Async function to fetch options based on search term */
  optionsFn?: (searchTerm: string) => Promise<unknown[]>;
  /** Function to transform option to display string */
  transformOptionToString?: (option: unknown) => string;
  /** Function to transform option to form value */
  transformOptionToValue?: (option: unknown) => unknown;
  /** Custom filter function for local filtering */
  filterFn?: (searchTerm: string, options: unknown[]) => unknown[];
  /** Whether to show the clear button (defaults to true) */
  showClearBtn?: boolean;
}

/**
 * Template options for Slider field
 */
export interface SpartanSliderTemplateOptions
  extends SpartanBaseTemplateOptions {
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean;
}

/**
 * Template options for Input OTP field
 */
export interface SpartanInputOtpTemplateOptions
  extends SpartanBaseTemplateOptions {
  length?: number;
  pattern?: string;
}

/**
 * Template options for Avatar Upload field
 */
export interface SpartanAvatarUploadTemplateOptions
  extends SpartanBaseTemplateOptions {
  /** Alternative text for the image */
  alt?: string;
  /** Accepted file types (default: 'image/png,image/jpeg,image/jpg') */
  accept?: string;
  /** Maximum file size in bytes (default: 2MB) */
  maxSize?: number;
  /** Size variant of the avatar ('sm' | 'default' | 'lg') */
  size?: 'sm' | 'default' | 'lg';
  /** Show remove button when image is uploaded */
  showRemoveButton?: boolean;
  /** Text to display below the avatar */
  uploadText?: string;
  /** Hint text to display below */
  uploadHint?: string;
  /** Initials to show in fallback */
  initials?: string;
}

/**
 * Template options for Image Upload field
 */
export interface SpartanImageUploadTemplateOptions
  extends SpartanBaseTemplateOptions {
  /** Accepted file types (default: 'image/*') */
  accept?: string;
  /** Maximum size per image in bytes */
  maxSize?: number;
  /** Minimum size per image in bytes */
  minSize?: number;
  /** Minimum number of images */
  minCount?: number;
  /** Maximum number of images (undefined for no limit) */
  maxCount?: number;
  /** Maximum total size of all images in bytes */
  maxTotalSize?: number;
  /** Upload area title */
  uploadTitle?: string;
  /** Upload area hint */
  uploadHint?: string;
  /** Browse button text */
  browseButtonText?: string;
}

/**
 * Template options for Single Image Upload field
 */
export interface SpartanSingleImageUploadTemplateOptions
  extends SpartanBaseTemplateOptions {
  /** Accepted file types (default: 'image/*') */
  accept?: string;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Minimum file size in bytes */
  minSize?: number;
  /** Button text */
  buttonText?: string;
  /** Button variant */
  buttonVariant?:
    | 'default'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'ghost'
    | 'link';
  /** Show icon instead of text in button */
  showIcon?: boolean;
  /** Empty state text when no image is selected */
  emptyText?: string;
}

/**
 * Union type of all template options
 */
export type SpartanTemplateOptions =
  | SpartanInputTemplateOptions
  | SpartanInputGroupTemplateOptions
  | SpartanTextareaTemplateOptions
  | SpartanSelectTemplateOptions
  | SpartanMultiselectTemplateOptions
  | SpartanRadioGroupTemplateOptions
  | SpartanCheckboxTemplateOptions
  | SpartanSwitchTemplateOptions
  | SpartanDatePickerTemplateOptions
  | SpartanDateRangePickerTemplateOptions
  | SpartanAutocompleteTemplateOptions
  | SpartanSliderTemplateOptions
  | SpartanInputOtpTemplateOptions
  | SpartanAvatarUploadTemplateOptions
  | SpartanImageUploadTemplateOptions
  | SpartanSingleImageUploadTemplateOptions;

/**
 * Type-safe field config based on field type
 */
export type SpartanFieldConfig<T extends SpartanFieldType = SpartanFieldType> =
  FormlyFieldConfig & {
    type: T;
    props?: T extends SpartanFieldType.INPUT
      ? SpartanInputTemplateOptions
      : T extends SpartanFieldType.INPUT_GROUP
        ? SpartanInputGroupTemplateOptions
        : T extends SpartanFieldType.TEXTAREA
          ? SpartanTextareaTemplateOptions
          : T extends SpartanFieldType.SELECT
            ? SpartanSelectTemplateOptions
            : T extends SpartanFieldType.MULTISELECT
              ? SpartanMultiselectTemplateOptions
              : T extends SpartanFieldType.RADIO_GROUP
                ? SpartanRadioGroupTemplateOptions
                : T extends SpartanFieldType.CHECKBOX
                  ? SpartanCheckboxTemplateOptions
                  : T extends SpartanFieldType.SWITCH
                    ? SpartanSwitchTemplateOptions
                    : T extends SpartanFieldType.DATE_PICKER
                      ? SpartanDatePickerTemplateOptions
                      : T extends SpartanFieldType.DATE_RANGE_PICKER
                        ? SpartanDateRangePickerTemplateOptions
                        : T extends SpartanFieldType.AUTOCOMPLETE
                          ? SpartanAutocompleteTemplateOptions
                          : T extends SpartanFieldType.SLIDER
                            ? SpartanSliderTemplateOptions
                            : T extends SpartanFieldType.INPUT_OTP
                              ? SpartanInputOtpTemplateOptions
                              : T extends SpartanFieldType.AVATAR_UPLOAD
                                ? SpartanAvatarUploadTemplateOptions
                                : T extends SpartanFieldType.IMAGE_UPLOAD
                                  ? SpartanImageUploadTemplateOptions
                                  : T extends SpartanFieldType.SINGLE_IMAGE_UPLOAD
                                    ? SpartanSingleImageUploadTemplateOptions
                                    : SpartanBaseTemplateOptions;
  };
