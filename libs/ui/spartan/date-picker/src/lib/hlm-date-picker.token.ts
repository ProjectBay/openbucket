import {
  inject,
  Injectable,
  InjectionToken,
  signal,
  type ValueProvider,
} from '@angular/core';

export interface HlmDatePickerConfig<T> {
  /**
   * If true, the date picker will close when a date is selected.
   */
  autoCloseOnSelect: boolean;

  /**
   * Defines how the date should be displayed in the UI.
   *
   * @param date
   * @returns formatted date
   */
  formatDate: (date: T) => string;

  /**
   * Defines how the date should be transformed before saving to model/form.
   *
   * @param date
   * @returns transformed date
   */
  transformDate: (date: T) => T;
}

export function getDefaultConfig<T>(): HlmDatePickerConfig<T> {
  return {
    formatDate: (date) =>
      date instanceof Date ? date.toDateString() : `${date}`,
    transformDate: (date) => date,
    autoCloseOnSelect: false,
  };
}

const HlmDatePickerConfigToken = new InjectionToken<
  HlmDatePickerConfig<unknown>
>('HlmDatePickerConfig');

export function provideHlmDatePickerConfig<T>(
  config: Partial<HlmDatePickerConfig<T>>,
): ValueProvider {
  return {
    provide: HlmDatePickerConfigToken,
    useValue: { ...getDefaultConfig(), ...config },
  };
}

export function injectHlmDatePickerConfig<T>(): HlmDatePickerConfig<T> {
  const injectedConfig = inject(HlmDatePickerConfigToken, { optional: true });
  return injectedConfig
    ? (injectedConfig as HlmDatePickerConfig<T>)
    : getDefaultConfig();
}

/**
 * Service for managing date picker configuration at runtime
 */
@Injectable({ providedIn: 'root' })
export class HlmDatePickerService<T = Date> {
  private readonly _config =
    signal<HlmDatePickerConfig<T>>(getDefaultConfig<T>());

  /**
   * Get the current configuration as a readonly signal
   */
  public readonly config = this._config.asReadonly();

  /**
   * Update the date picker configuration at runtime
   * @param config Partial configuration to merge with current config
   */
  use(config: Partial<HlmDatePickerConfig<T>>): void {
    this._config.update((current) => ({ ...current, ...config }));
  }

  /**
   * Initialize with a specific configuration (used during app initialization)
   * @param config Initial configuration
   */
  initialize(config: Partial<HlmDatePickerConfig<T>>): void {
    this._config.set({ ...getDefaultConfig<T>(), ...config });
  }
}

/**
 * Inject the date picker service for runtime configuration
 */
export function injectHlmDatePickerService<
  T = Date,
>(): HlmDatePickerService<T> {
  return inject(HlmDatePickerService) as HlmDatePickerService<T>;
}
