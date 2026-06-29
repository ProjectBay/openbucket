import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { type LocaleCode } from '../../locale/store/locale.store';
import { LocaleService } from '../../locale/services/locale.service';

export type Theme = 'light' | 'dark' | 'system';
export type ShellVariant = 'compact' | 'inset' | 'sticky';
export type TabsVariant = 'default' | 'line';
export type ContentAlignment = 'center' | 'left';
export type ContentMaxWidth = 'full' | '2xl' | '3xl' | '4xl' | '5xl';
export type ColorScheme =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'violet'
  | 'blue'
  | 'green'
  | 'orange'
  | 'red'
  | 'rose'
  | 'yellow';

interface AppearanceState {
  theme: Theme;
  shellVariant: ShellVariant;
  tabsVariant: TabsVariant;
  contentAlignment: ContentAlignment;
  contentMaxWidth: ContentMaxWidth;
  colorScheme: ColorScheme;
  locale: LocaleCode;
  reducedMotion: boolean;
}

const STORAGE_KEY = 'appearance-settings';

const defaultState: AppearanceState = {
  theme: 'system',
  shellVariant: 'inset',
  tabsVariant: 'default',
  contentAlignment: 'center',
  contentMaxWidth: '4xl',
  colorScheme: 'slate',
  locale: 'en',
  reducedMotion: false,
};

/** Toggle the global `reduce-motion` class STORY-0616's CSS keys off. */
function applyReducedMotion(value: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', value);
}

function loadFromStorage(): AppearanceState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...defaultState, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return defaultState;
}

function saveToStorage(state: AppearanceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const initialState: AppearanceState = loadFromStorage();

export const AppearanceStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    effectiveTheme: computed(() => {
      const theme = store.theme();
      if (theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      }
      return theme;
    }),
  })),
  withMethods((store) => {
    const localeService = inject(LocaleService);

    const snapshot = (): AppearanceState => ({
      theme: store.theme(),
      shellVariant: store.shellVariant(),
      tabsVariant: store.tabsVariant(),
      contentAlignment: store.contentAlignment(),
      contentMaxWidth: store.contentMaxWidth(),
      colorScheme: store.colorScheme(),
      locale: store.locale(),
      reducedMotion: store.reducedMotion(),
    });

    return {
      setTheme(theme: Theme): void {
        patchState(store, { theme });
        saveToStorage({ ...snapshot(), theme });
      },
      setShellVariant(shellVariant: ShellVariant): void {
        patchState(store, { shellVariant });
        saveToStorage({ ...snapshot(), shellVariant });
      },
      setTabsVariant(tabsVariant: TabsVariant): void {
        patchState(store, { tabsVariant });
        saveToStorage({ ...snapshot(), tabsVariant });
      },
      setContentAlignment(contentAlignment: ContentAlignment): void {
        patchState(store, { contentAlignment });
        saveToStorage({ ...snapshot(), contentAlignment });
      },
      setContentMaxWidth(contentMaxWidth: ContentMaxWidth): void {
        patchState(store, { contentMaxWidth });
        saveToStorage({ ...snapshot(), contentMaxWidth });
      },
      setColorScheme(colorScheme: ColorScheme): void {
        patchState(store, { colorScheme });
        saveToStorage({ ...snapshot(), colorScheme });
      },
      setLocale(locale: LocaleCode): void {
        patchState(store, { locale });
        localeService.applyLocale(locale);
        saveToStorage({ ...snapshot(), locale });
      },
      setReducedMotion(reducedMotion: boolean): void {
        patchState(store, { reducedMotion });
        applyReducedMotion(reducedMotion);
        saveToStorage({ ...snapshot(), reducedMotion });
      },
      reset(): void {
        patchState(store, defaultState);
        localeService.applyLocale(defaultState.locale);
        applyReducedMotion(defaultState.reducedMotion);
        saveToStorage(defaultState);
      },
    };
  }),
  withHooks({
    onInit(store) {
      applyReducedMotion(store.reducedMotion());
    },
  }),
);
