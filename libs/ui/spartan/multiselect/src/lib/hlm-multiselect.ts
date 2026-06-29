import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { provideIcons } from '@ng-icons/core';
import { lucideX, lucideChevronDown } from '@ng-icons/lucide';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmBadgeImports } from '@openbucket/spartan-ui/badge';
import { HlmSelectImports } from '@openbucket/spartan-ui/select';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import type { ClassValue } from 'clsx';
import { hlm } from '@openbucket/spartan-ui/utils';

export interface MultiselectOption {
  label: string;
  value: unknown;
  disabled?: boolean;
}

export const HLM_MULTISELECT_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmMultiselect),
  multi: true,
};

@Component({
  selector: 'hlm-multiselect',
  imports: [
    HlmIconImports,
    HlmBadgeImports,
    HlmSelectImports,
    BrnSelectImports,
  ],
  providers: [
    HLM_MULTISELECT_VALUE_ACCESSOR,
    provideIcons({ lucideX, lucideChevronDown }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '_computedClass()',
  },
  template: `
    <div class="w-full">
      <!-- Select with Chips Inside -->
      <hlm-select
        [multiple]="true"
        [value]="selectedValues()"
        (valueChange)="onSelectionChange($event)"
        [disabled]="_disabled()"
      >
        <hlm-select-trigger class="w-full min-h-10 h-auto py-2">
          <div class="flex flex-wrap gap-2 w-full pr-8">
            @if (selectedItems().length === 0) {
              <span class="text-sm text-muted-foreground">{{
                placeholder()
              }}</span>
            }
            @for (item of selectedItems(); track item.value) {
              <span
                hlmBadge
                variant="secondary"
                class="inline-flex items-center gap-1 pr-1"
              >
                {{ item.label }}
                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-sm hover:bg-secondary-foreground/10 transition-colors"
                  (click)="removeItem($event, item.value)"
                  [disabled]="_disabled()"
                >
                  <ng-icon
                    name="lucideX"
                    size="14"
                  />
                </button>
              </span>
            }
          </div>
          <ng-icon
            name="lucideChevronDown"
            size="16"
            class="absolute right-3 top-1/2 -translate-y-1/2"
          />
        </hlm-select-trigger>
        <hlm-select-content>
          @for (option of options(); track option.value) {
            <hlm-option
              [value]="option.value"
              [disabled]="option.disabled || false"
            >
              {{ option.label }}
            </hlm-option>
          }
        </hlm-select-content>
      </hlm-select>
    </div>
  `,
})
export class HlmMultiselect implements ControlValueAccessor {
  /** Available options */
  public readonly options = input.required<MultiselectOption[]>();

  /** Placeholder text */
  public readonly placeholder = input<string>('Select items');

  /** Label for dropdown button */
  public readonly dropdownLabel = input<string>('Select items');

  /** Additional class names */
  public readonly userClass = input<ClassValue>('');

  /** Selected values */
  protected readonly selectedValues = signal<unknown[]>([]);

  /** Disabled state */
  protected readonly _disabled = signal<boolean>(false);

  /** Computed class */
  protected readonly _computedClass = computed(() =>
    hlm('w-full', this.userClass()),
  );

  /** Computed selected items with labels */
  protected readonly selectedItems = computed(() => {
    const values = this.selectedValues();
    const opts = this.options();
    return values
      .map((val) => opts.find((opt) => opt.value === val))
      .filter((item): item is MultiselectOption => item !== undefined);
  });

  // ControlValueAccessor implementation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onChange: (value: unknown[] | null) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onTouched: () => void = () => {};

  onSelectionChange(values: unknown): void {
    const valuesArray = Array.isArray(values) ? values : [];
    this.selectedValues.set(valuesArray);
    this._onChange(valuesArray);
    this._onTouched();
  }

  removeItem(event: Event, value: unknown): void {
    event.stopPropagation();
    event.preventDefault();

    const currentValues = this.selectedValues();
    const newValues = currentValues.filter((v) => v !== value);
    this.selectedValues.set(newValues);
    this._onChange(newValues);
    this._onTouched();
  }

  // ControlValueAccessor methods
  writeValue(value: unknown[] | null): void {
    this.selectedValues.set(value || []);
  }

  registerOnChange(fn: (value: unknown[] | null) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled.set(isDisabled);
  }
}
