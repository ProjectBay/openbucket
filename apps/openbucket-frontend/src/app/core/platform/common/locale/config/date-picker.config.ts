import type { HlmDatePickerConfig } from '@openbucket/spartan-ui/date-picker';
import type { LocaleCode } from '../store/locale.store';

export const EN_DATE_PICKER_CONFIG: Partial<HlmDatePickerConfig<Date>> = {
  formatDate: (date) => {
    if (!date) return '';
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${m}/${d}/${date.getFullYear()}`;
  },
  transformDate: (d) => d,
  autoCloseOnSelect: true,
};

export const DE_DATE_PICKER_CONFIG: Partial<HlmDatePickerConfig<Date>> = {
  formatDate: (date) => {
    if (!date) return '';
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}.${m}.${date.getFullYear()}`;
  },
  transformDate: (d) => d,
  autoCloseOnSelect: true,
};

export const DATE_PICKER_CONFIGS: Record<
  LocaleCode,
  Partial<HlmDatePickerConfig<Date>>
> = {
  en: EN_DATE_PICKER_CONFIG,
  de: DE_DATE_PICKER_CONFIG,
};
