import {
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';
import { firstValueFrom } from 'rxjs';
import { HlmAutocompleteImports } from '@openbucket/spartan-ui/autocomplete';
import { HlmSpinnerImports } from '@openbucket/spartan-ui/spinner';
import {
  AutocompleteHttpConfig,
  SpartanFormlyAutocompleteDataService,
} from '../services/autocomplete-data.service';

type AutocompleteOption = unknown;
type OptionsFn = (search: string) => Promise<AutocompleteOption[]> | AutocompleteOption[];
type FilterFn = (
  search: string,
  options: AutocompleteOption[],
) => AutocompleteOption[];

/**
 * Formly field type for the Spartan Autocomplete component.
 *
 * Resolution order for the option source:
 *   1. `props.httpOptions` â€” HTTP-backed via SpartanFormlyAutocompleteDataService
 *   2. `props.optionsFn`   â€” async function returning options
 *   3. `props.options`     â€” static array
 */
@Component({
  selector: 'lib-spartan-formly-field-autocomplete',
  imports: [ReactiveFormsModule, HlmAutocompleteImports, HlmSpinnerImports],
  template: `
    <hlm-autocomplete
      [filteredOptions]="filteredOptions()"
      [(search)]="search"
      [formControl]="formControl"
      [searchPlaceholderText]="props['placeholder'] || 'Search...'"
      [inputId]="id"
      [loading]="isLoading()"
      [showClearBtn]="props['showClearBtn'] ?? true"
      [transformOptionToString]="transformOptionToString"
      [transformOptionToValue]="transformOptionToValue"
      [displayWith]="displayWith"
    >
      <hlm-spinner
        loading
        class="size-6"
      />
    </hlm-autocomplete>
  `,
})
export class SpartanFormlyFieldAutocomplete extends FieldType<FieldTypeConfig> {
  private readonly dataService = inject(SpartanFormlyAutocompleteDataService);

  public readonly search = signal('');

  public readonly optionsResource = resource<AutocompleteOption[], { search: string }>({
    defaultValue: [],
    params: () => ({ search: this.search() }),
    loader: async ({ params }) => {
      const searchTerm = params.search;
      const httpOptions = this.props['httpOptions'] as
        | AutocompleteHttpConfig
        | undefined;
      const optionsFn = this.props['optionsFn'] as OptionsFn | undefined;
      const staticOptions = this.props['options'] as
        | AutocompleteOption[]
        | undefined;

      if (httpOptions) {
        const results = await firstValueFrom(
          this.dataService.fetch(httpOptions, searchTerm),
        );
        return Array.isArray(results) ? results : [];
      }

      if (typeof optionsFn === 'function') {
        const results = await optionsFn(searchTerm);
        return Array.isArray(results) ? results : [];
      }

      if (Array.isArray(staticOptions)) {
        return staticOptions;
      }

      return [];
    },
  });

  public readonly isLoading = computed(() => this.optionsResource.isLoading());

  public readonly filteredOptions = computed<AutocompleteOption[]>(() => {
    const searchTerm = this.search().toLowerCase();
    const allOptions = this.optionsResource.value() ?? [];

    if (!searchTerm) {
      return allOptions;
    }

    // HTTP-backed: assume the server already filtered.
    if (this.props['httpOptions']) {
      return allOptions;
    }

    const filterFn = this.props['filterFn'] as FilterFn | undefined;
    if (typeof filterFn === 'function') {
      return filterFn(searchTerm, allOptions);
    }

    return allOptions.filter((option) => {
      const displayValue = this.transformOptionToString(option);
      return displayValue.toLowerCase().includes(searchTerm);
    });
  });

  public readonly transformOptionToString = (option: AutocompleteOption): string => {
    const transformFn = this.props['transformOptionToString'] as
      | ((opt: AutocompleteOption) => string)
      | undefined;
    if (typeof transformFn === 'function') {
      return transformFn(option);
    }
    return typeof option === 'string' ? option : String(option);
  };

  public readonly transformOptionToValue = this.props['transformOptionToValue']
    ? (this.props['transformOptionToValue'] as (opt: AutocompleteOption) => unknown)
    : undefined;

  public readonly displayWith = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }

    const allOptions = this.optionsResource.value() ?? [];
    const transformToValue = this.transformOptionToValue;

    if (typeof transformToValue === 'function') {
      const matchingOption = allOptions.find(
        (option) => transformToValue(option) === value,
      );

      if (matchingOption) {
        return this.transformOptionToString(matchingOption);
      }
    }

    return this.transformOptionToString(value);
  };
}
