import { EnvironmentProviders } from '@angular/core';
import { provideApi } from '@openbucket/api-client';

/**
 * Wire the generated admin API client into DI (§5.13). `basePath: ''` — the SPA
 * is served same-origin by the backend; the authInterceptor attaches the bearer.
 * The generated services are `providedIn: 'root'`, so only the base-path /
 * Configuration provider is needed.
 */
export function provideApiClient(): EnvironmentProviders {
  return provideApi({ basePath: '' });
}
