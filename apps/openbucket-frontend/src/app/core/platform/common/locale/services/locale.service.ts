import { Injectable, inject } from '@angular/core';
import { injectBrnCalendarI18n } from '@spartan-ng/brain/calendar';
import { injectHlmDatePickerService } from '@openbucket/spartan-ui/date-picker';
import { TranslateService } from '@ngx-translate/core';
import { LocaleStore, type LocaleCode } from '../store/locale.store';
import { CALENDAR_I18N_CONFIGS } from '../config/calendar-i18n.config';
import { DATE_PICKER_CONFIGS } from '../config/date-picker.config';

@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly localeStore = inject(LocaleStore);
  private readonly calendarI18nService = injectBrnCalendarI18n();
  private readonly datePickerService = injectHlmDatePickerService<Date>();
  private readonly translate = inject(TranslateService);

  initialize(): void {
    const locale = this.localeStore.currentLocale();
    this.updateCalendarI18n(locale);
    this.updateDatePickerConfig(locale);
    this.syncTranslateLanguage(locale);
  }

  updateCalendarI18n(locale: LocaleCode): void {
    const config = CALENDAR_I18N_CONFIGS[locale];
    if (config) this.calendarI18nService.use(config);
  }

  updateDatePickerConfig(locale: LocaleCode): void {
    const config = DATE_PICKER_CONFIGS[locale];
    if (config) this.datePickerService.use(config);
  }

  syncTranslateLanguage(locale: LocaleCode): void {
    if (this.translate.currentLang !== locale) {
      this.translate.use(locale);
    }
  }

  applyLocale(locale: LocaleCode): void {
    this.localeStore.setLocale(locale);
    this.updateCalendarI18n(locale);
    this.updateDatePickerConfig(locale);
    this.syncTranslateLanguage(locale);
  }

  getCurrentLocale(): LocaleCode {
    return this.localeStore.currentLocale();
  }

  getAvailableLocales() {
    return this.localeStore.availableLocales();
  }
}
