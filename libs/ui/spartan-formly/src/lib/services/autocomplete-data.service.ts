import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';

export interface AutocompleteHttpConfig<T = unknown> {
  url: string;
  queryParam?: string;
  method?: 'GET' | 'POST';
  extraParams?: Record<string, string | number | boolean>;
  transformResponse?: (response: unknown) => T[];
  minSearchLength?: number;
}

/**
 * Fetches autocomplete option lists over HTTP for the
 * Spartan Formly autocomplete field type.
 *
 * Default shape: `GET {url}?{queryParam ?? 'q'}={search}` returning an array.
 * Override `method`, `queryParam`, `extraParams`, or `transformResponse` as needed.
 */
@Injectable({ providedIn: 'root' })
export class SpartanFormlyAutocompleteDataService {
  private readonly http = inject(HttpClient);

  fetch<T = unknown>(
    config: AutocompleteHttpConfig<T>,
    search: string,
  ): Observable<T[]> {
    if (
      config.minSearchLength !== undefined &&
      search.length < config.minSearchLength
    ) {
      return of([]);
    }

    const paramName = config.queryParam ?? 'q';
    const method = config.method ?? 'GET';

    const request$ =
      method === 'POST'
        ? this.http.post<unknown>(config.url, {
            [paramName]: search,
            ...(config.extraParams ?? {}),
          })
        : this.http.get<unknown>(config.url, {
            params: this.buildParams(paramName, search, config.extraParams),
          });

    return request$.pipe(
      map((response) => {
        if (config.transformResponse) {
          return config.transformResponse(response);
        }
        return Array.isArray(response) ? (response as T[]) : [];
      }),
    );
  }

  private buildParams(
    queryParam: string,
    search: string,
    extra?: Record<string, string | number | boolean>,
  ): HttpParams {
    let params = new HttpParams().set(queryParam, search);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        params = params.set(key, String(value));
      }
    }
    return params;
  }
}
