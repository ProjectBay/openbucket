import { computed } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';

export type LocaleCode = 'en' | 'de';

export interface LocaleConfig {
  code: LocaleCode;
  name: string;
  nativeName: string;
  dateFormat: string;
  firstDayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface LocaleState {
  currentLocale: LocaleCode;
}

const STORAGE_KEY = 'app_locale';

export const LOCALE_CONFIGS: Record<LocaleCode, LocaleConfig> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    dateFormat: 'MM/dd/yyyy',
    firstDayOfWeek: 0,
  },
  de: {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    dateFormat: 'dd.MM.yyyy',
    firstDayOfWeek: 1,
  },
};

function detectBrowserLocale(): LocaleCode {
  try {
    const lang = navigator.language || 'en';
    const code = lang.split('-')[0].toLowerCase();
    if (code === 'en' || code === 'de') return code;
  } catch {
    // ignore
  }
  return 'en';
}

function loadFromStorage(): LocaleState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALE_CONFIGS[stored as LocaleCode]) {
      return { currentLocale: stored as LocaleCode };
    }
  } catch {
    // ignore
  }
  return { currentLocale: detectBrowserLocale() };
}

function saveToStorage(state: LocaleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, state.currentLocale);
  } catch {
    // ignore
  }
}

export const LocaleStore = signalStore(
  { providedIn: 'root' },
  withState(loadFromStorage()),
  withComputed((store) => ({
    localeConfig: computed(() => LOCALE_CONFIGS[store.currentLocale()]),
    availableLocales: computed(() => Object.values(LOCALE_CONFIGS)),
    firstDayOfWeek: computed(
      () => LOCALE_CONFIGS[store.currentLocale()].firstDayOfWeek,
    ),
    dateFormat: computed(() => LOCALE_CONFIGS[store.currentLocale()].dateFormat),
  })),
  withMethods((store) => ({
    setLocale(locale: LocaleCode): void {
      if (!LOCALE_CONFIGS[locale]) return;
      const newState = { currentLocale: locale };
      patchState(store, newState);
      saveToStorage(newState);
    },
    isLocaleSupported(locale: string): locale is LocaleCode {
      return locale in LOCALE_CONFIGS;
    },
  })),
);
