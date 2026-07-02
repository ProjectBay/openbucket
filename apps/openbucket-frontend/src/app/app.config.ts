import {
  provideHttpClient,
  withFetch,
  withInterceptors,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { FORMLY_CONFIG, provideFormlyCore } from '@ngx-formly/core';
import {
  TranslateLoader,
  TranslateModule,
  TranslateService,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { provideBrnCalendarI18n } from '@spartan-ng/brain/calendar';
import { provideHlmDatePickerConfig } from '@openbucket/spartan-ui/date-picker';
import {
  SPARTAN_FORMLY_CONFIG,
  registerTranslateExtension,
} from '@openbucket/spartan-ui/formly';
import { appRoutes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';
import { AuthService } from './auth/auth.service';
import { provideApiClient } from './shared/api/api-client.providers';
import { mountPrefixInterceptor } from './shared/api/mount-prefix';
import {
  CALENDAR_I18N_CONFIGS,
  ColorSchemeService,
  DATE_PICKER_CONFIGS,
  LocaleService,
  ThemeService,
} from './core/platform';
import enTranslations from './i18n/en.translations';
import deTranslations from './i18n/de.translations';

class InMemoryTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<Record<string, unknown>> {
    const dict =
      lang === 'de'
        ? (deTranslations as Record<string, unknown>)
        : (enTranslations as Record<string, unknown>);
    return of(dict);
  }
}

const initializeOpenbucketProviders = async (): Promise<void> => {
  inject(ThemeService).initialize();
  inject(ColorSchemeService).initialize();
  inject(LocaleService).initialize();
  // Rehydrate the admin session from the HttpOnly refresh cookie BEFORE the router
  // and route guards evaluate, so a page reload doesn't bounce to /login (§5.12).
  // inject() must run synchronously (before the await) to keep the DI context.
  const auth = inject(AuthService);
  await auth.refresh();
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrnCalendarI18n(CALENDAR_I18N_CONFIGS['en']),
    provideHlmDatePickerConfig(DATE_PICKER_CONFIGS['en']),
    provideHttpClient(
      withFetch(),
      // authInterceptor FIRST (its auth-path check keys on the un-prefixed
      // `/api/admin/auth/*` URL); mountPrefixInterceptor then prepends the mount.
      withInterceptors([authInterceptor, mountPrefixInterceptor]),
      withInterceptorsFromDi(),
    ),
    provideApiClient(),
    provideAnimations(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes, withComponentInputBinding()),
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: 'en',
        loader: {
          provide: TranslateLoader,
          useClass: InMemoryTranslateLoader,
        },
      }),
    ),
    provideAppInitializer(initializeOpenbucketProviders),
    provideFormlyCore(SPARTAN_FORMLY_CONFIG),
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useFactory: registerTranslateExtension,
      deps: [TranslateService],
    },
  ],
};
