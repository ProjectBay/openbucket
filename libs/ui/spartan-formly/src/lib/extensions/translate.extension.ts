import { FormlyExtension, FormlyFieldConfig } from '@ngx-formly/core';
import { TranslateService } from '@ngx-translate/core';
import { map, startWith } from 'rxjs';

/**
 * Formly extension that translates field properties and validation messages
 * using @ngx-translate.
 *
 * Automatically translates the following properties if they look like translation keys:
 * - label, placeholder, description, hint, tooltip
 * - uploadTitle, uploadHint, uploadText, browseButtonText
 * - emptyText, buttonText, switchLabel
 * - fieldsetLegend, fieldsetDescription, alt, labelParts
 *
 * Also provides reactive validation message translations that update when the language changes.
 */
export class TranslateExtension implements FormlyExtension {
  private readonly langChanges$;

  constructor(private translate: TranslateService) {
    this.langChanges$ = this.translate.onLangChange.pipe(
      map((e) => e.lang),
      startWith(this.translate.currentLang),
    );
  }

  prePopulate(field: FormlyFieldConfig): void {
    const props = field.props || field.templateOptions;
    if (!props) {
      return;
    }

    const translatableProps = [
      'label',
      'placeholder',
      'description',
      'hint',
      'tooltip',
      'uploadTitle',
      'uploadHint',
      'uploadText',
      'browseButtonText',
      'emptyText',
      'buttonText',
      'switchLabel',
      'fieldsetLegend',
      'fieldsetDescription',
      'alt',
      'prefixText',
      'suffixText',
      'prefixSpinnerText',
      'suffixSpinnerText',
    ];

    translatableProps.forEach((prop) => {
      const value = props[prop];
      if (typeof value === 'string' && this.shouldTranslate(value)) {
        field.expressions = {
          ...(field.expressions || {}),
          [`props.${prop}`]: this.translate.stream(value),
        };
      }
    });

    const buttonProps = ['prefixButton', 'suffixButton'];
    buttonProps.forEach((buttonProp) => {
      const button = props[buttonProp];
      if (button && typeof button === 'object') {
        const btn = button as Record<string, unknown>;

        if (
          'text' in btn &&
          typeof btn['text'] === 'string' &&
          this.shouldTranslate(btn['text'])
        ) {
          field.expressions = {
            ...(field.expressions || {}),
            [`props.${buttonProp}.text`]: this.translate.stream(
              btn['text'] as string,
            ),
          };
        }

        if (
          'tooltip' in btn &&
          typeof btn['tooltip'] === 'string' &&
          this.shouldTranslate(btn['tooltip'])
        ) {
          field.expressions = {
            ...(field.expressions || {}),
            [`props.${buttonProp}.tooltip`]: this.translate.stream(
              btn['tooltip'] as string,
            ),
          };
        }
      }
    });

    const buttonArrayProps = ['topButtons', 'bottomButtons'];
    buttonArrayProps.forEach((buttonArrayProp) => {
      const buttons = props[buttonArrayProp];
      if (Array.isArray(buttons)) {
        const originalButtons = buttons;

        field.expressions = {
          ...(field.expressions || {}),
          [`props.${buttonArrayProp}`]: this.langChanges$.pipe(
            map(() =>
              originalButtons.map((button: unknown) => {
                if (typeof button === 'object' && button !== null) {
                  const btn = button as Record<string, unknown>;
                  const translated: Record<string, unknown> = { ...btn };

                  if (
                    'text' in btn &&
                    typeof btn['text'] === 'string' &&
                    this.shouldTranslate(btn['text'])
                  ) {
                    translated['text'] = this.translate.instant(
                      btn['text'] as string,
                    );
                  }

                  if (
                    'tooltip' in btn &&
                    typeof btn['tooltip'] === 'string' &&
                    this.shouldTranslate(btn['tooltip'])
                  ) {
                    translated['tooltip'] = this.translate.instant(
                      btn['tooltip'] as string,
                    );
                  }

                  return translated;
                }
                return button;
              }),
            ),
          ),
        };
      }
    });

    if (Array.isArray(props['options'])) {
      const originalOptions = props['options'];

      const translateOptions = (opts: unknown[]): unknown[] => {
        return opts.map((option: unknown) => {
          if (typeof option === 'object' && option !== null) {
            const opt = option as Record<string, unknown>;
            const translated: Record<string, unknown> = { ...opt };

            if (
              'label' in opt &&
              typeof opt['label'] === 'string' &&
              this.shouldTranslate(opt['label'])
            ) {
              translated['label'] = this.translate.instant(
                opt['label'] as string,
              );
            }

            if ('labelParts' in opt && Array.isArray(opt['labelParts'])) {
              translated['labelParts'] = (opt['labelParts'] as unknown[]).map(
                (part: unknown) => {
                  if (typeof part === 'string' && this.shouldTranslate(part)) {
                    return this.translate.instant(part);
                  }
                  if (typeof part === 'object' && part !== null) {
                    const p = part as Record<string, unknown>;
                    const translatedPart: Record<string, unknown> = { ...p };

                    if (
                      'text' in p &&
                      typeof p['text'] === 'string' &&
                      this.shouldTranslate(p['text'])
                    ) {
                      translatedPart['text'] = this.translate.instant(
                        p['text'] as string,
                      );
                    }

                    return translatedPart;
                  }
                  return part;
                },
              );
            }

            if ('options' in opt && Array.isArray(opt['options'])) {
              translated['options'] = translateOptions(opt['options']);
            }

            return translated;
          }
          return option;
        });
      };

      field.expressions = {
        ...(field.expressions || {}),
        'props.options': this.langChanges$.pipe(
          map(() => translateOptions(originalOptions)),
        ),
      };
    }

    if (Array.isArray(props['labelParts'])) {
      const originalLabelParts = props['labelParts'];

      const translateLabelParts = (parts: unknown[]): unknown[] => {
        return parts.map((part: unknown) => {
          if (typeof part === 'string' && this.shouldTranslate(part)) {
            return this.translate.instant(part);
          }
          if (typeof part === 'object' && part !== null) {
            const p = part as Record<string, unknown>;
            const translated: Record<string, unknown> = { ...p };

            if (
              'text' in p &&
              typeof p['text'] === 'string' &&
              this.shouldTranslate(p['text'])
            ) {
              translated['text'] = this.translate.instant(p['text'] as string);
            }

            return translated;
          }
          return part;
        });
      };

      field.expressions = {
        ...(field.expressions || {}),
        'props.labelParts': this.langChanges$.pipe(
          map(() => translateLabelParts(originalLabelParts)),
        ),
      };
    }

    if (field.validation?.messages) {
      Object.keys(field.validation.messages).forEach((key) => {
        const message = field.validation?.messages?.[key];
        if (typeof message === 'string' && this.shouldTranslate(message)) {
          if (!field.expressions) {
            field.expressions = {};
          }
          field.expressions[`validation.messages.${key}`] =
            this.translate.stream(message);
        }
      });
    }
  }

  /**
   * Determines if a string should be treated as a translation key.
   */
  private shouldTranslate(value: string): boolean {
    return (
      value.includes('.') ||
      value.startsWith('form.') ||
      value.startsWith('field.') ||
      value.startsWith('validation.') ||
      value.startsWith('common.') ||
      value.startsWith('showcase.')
    );
  }
}

/**
 * Factory function to register the Translate extension with Formly.
 */
export function registerTranslateExtension(translate: TranslateService) {
  return {
    extensions: [
      {
        name: 'translate',
        extension: new TranslateExtension(translate),
      },
    ],
    validationMessages: [
      {
        name: 'required',
        message: () => translate.stream('validation.required'),
      },
      {
        name: 'email',
        message: () => translate.stream('validation.email'),
      },
      {
        name: 'url',
        message: () => translate.stream('validation.url'),
      },
      {
        name: 'phone',
        message: () => translate.stream('validation.phone'),
      },
      {
        name: 'numeric',
        message: () => translate.stream('validation.numeric'),
      },
      {
        name: 'integer',
        message: () => translate.stream('validation.integer'),
      },
      {
        name: 'alphanumeric',
        message: () => translate.stream('validation.alphanumeric'),
      },
      {
        name: 'alphabetic',
        message: () => translate.stream('validation.alphabetic'),
      },
      {
        name: 'ipv4',
        message: () => translate.stream('validation.ipv4'),
      },
      {
        name: 'creditCard',
        message: () => translate.stream('validation.creditCard'),
      },
      {
        name: 'fieldMatch',
        message: () => translate.stream('validation.fieldMatch'),
      },
      {
        name: 'min',
        message: (_error: unknown, field: FormlyFieldConfig) =>
          translate.stream('validation.min', {
            min: field.props?.['min'],
          }),
      },
      {
        name: 'max',
        message: (_error: unknown, field: FormlyFieldConfig) =>
          translate.stream('validation.max', {
            max: field.props?.['max'],
          }),
      },
      {
        name: 'minlength',
        message: (_error: unknown, field: FormlyFieldConfig) =>
          translate.stream('validation.minlength', {
            minlength: field.props?.['minlength'],
          }),
      },
      {
        name: 'maxlength',
        message: (_error: unknown, field: FormlyFieldConfig) =>
          translate.stream('validation.maxlength', {
            maxlength: field.props?.['maxlength'],
          }),
      },
      {
        name: 'minDate',
        message: () => translate.stream('validation.minDate'),
      },
      {
        name: 'maxDate',
        message: () => translate.stream('validation.maxDate'),
      },
      {
        name: 'pattern',
        message: () => translate.stream('validation.pattern'),
      },
      {
        name: 'minSize',
        message: (error: { required: number; actual: number }) => {
          const minSizeMB = (error.required / 1024 / 1024).toFixed(2);
          const actualSizeMB = (error.actual / 1024 / 1024).toFixed(2);
          return translate.stream('validation.minSize', {
            minSize: minSizeMB,
            actualSize: actualSizeMB,
          });
        },
      },
      {
        name: 'maxSize',
        message: (error: { required: number; actual: number }) => {
          const maxSizeMB = (error.required / 1024 / 1024).toFixed(2);
          const actualSizeMB = (error.actual / 1024 / 1024).toFixed(2);
          return translate.stream('validation.maxSize', {
            maxSize: maxSizeMB,
            actualSize: actualSizeMB,
          });
        },
      },
      {
        name: 'fileType',
        message: (error: { actual: string; accepted: string[] }) => {
          const accepted = error.accepted.join(', ');
          return translate.stream('validation.fileType', {
            actual: error.actual,
            accepted,
          });
        },
      },
      {
        name: 'minCount',
        message: (error: { required: number; actual: number }) =>
          translate.stream('validation.minCount', {
            required: error.required,
            actual: error.actual,
          }),
      },
      {
        name: 'maxCount',
        message: (error: { required: number; actual: number }) =>
          translate.stream('validation.maxCount', {
            required: error.required,
            actual: error.actual,
          }),
      },
      {
        name: 'maxTotalSize',
        message: (error: { required: number; actual: number }) => {
          const maxSizeMB = (error.required / 1024 / 1024).toFixed(2);
          const actualSizeMB = (error.actual / 1024 / 1024).toFixed(2);
          return translate.stream('validation.maxTotalSize', {
            maxSize: maxSizeMB,
            actualSize: actualSizeMB,
          });
        },
      },
    ],
  };
}
