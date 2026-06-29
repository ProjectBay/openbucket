import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import type {
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import {
  AbstractControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { provideIcons } from '@ng-icons/core';
import { lucideUpload, lucideX, lucideImage } from '@ng-icons/lucide';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import type { ClassValue } from 'clsx';
import { hlm } from '@openbucket/spartan-ui/utils';

export interface SingleImageUploadValue {
  filename: string;
  mime: string;
  size: number;
  base64: string;
}

export const HLM_SINGLE_IMAGE_UPLOAD_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmSingleImageUpload),
  multi: true,
};

export const HLM_SINGLE_IMAGE_UPLOAD_VALIDATOR = {
  provide: NG_VALIDATORS,
  useExisting: forwardRef(() => HlmSingleImageUpload),
  multi: true,
};

@Component({
  selector: 'hlm-single-image-upload',
  imports: [HlmIconImports, HlmButtonImports],
  providers: [
    HLM_SINGLE_IMAGE_UPLOAD_VALUE_ACCESSOR,
    HLM_SINGLE_IMAGE_UPLOAD_VALIDATOR,
    provideIcons({ lucideUpload, lucideX, lucideImage }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '_computedClass()',
  },
  template: `
    <div class="flex flex-col gap-3">
      <!-- Large Preview (only when showIcon is false) -->
      @if (image() && !showIcon()) {
        <div class="relative w-full max-w-sm">
          <div
            class="relative aspect-video rounded-lg overflow-hidden border-2 border-border"
          >
            <img
              [src]="image()!.base64"
              [alt]="image()!.filename"
              class="w-full h-full object-cover"
            />
            <button
              type="button"
              hlmBtn
              variant="destructive"
              size="icon"
              class="absolute top-2 right-2 size-8"
              (click)="removeImage()"
              [disabled]="_disabled()"
            >
              <ng-icon
                name="lucideX"
                size="16"
              />
            </button>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm">
            <span class="text-muted-foreground truncate">{{
              image()!.filename
            }}</span>
            <span class="text-muted-foreground">{{
              formatSize(image()!.size)
            }}</span>
          </div>
        </div>
      }

      <!-- Upload Button -->
      <div class="flex items-center gap-3">
        <input
          #fileInput
          type="file"
          [accept]="accept()"
          class="hidden"
          (change)="onFileSelected($event)"
          [disabled]="_disabled()"
        />

        @if (showIcon()) {
          <button
            type="button"
            hlmBtn
            variant="outline"
            size="icon"
            class="shrink-0 overflow-hidden p-0"
            [disabled]="_disabled()"
            (click)="fileInput.click()"
          >
            @if (image()) {
              <img
                [src]="image()!.base64"
                [alt]="image()!.filename"
                class="w-full h-full object-cover"
              />
            } @else {
              <ng-icon
                name="lucideImage"
                size="20"
              />
            }
          </button>
        }

        <button
          type="button"
          hlmBtn
          [variant]="buttonVariant()"
          [disabled]="_disabled()"
          (click)="fileInput.click()"
          class="gap-2"
        >
          <ng-icon
            name="lucideUpload"
            size="16"
          />
          {{ buttonText() }}
        </button>

        @if (!image()) {
          <span class="text-sm text-muted-foreground">
            {{ emptyText() }}
          </span>
        }
      </div>
    </div>
  `,
})
export class HlmSingleImageUpload implements ControlValueAccessor, Validator {
  /** Accepted file types */
  public readonly accept = input<string>('image/png,image/jpeg,image/jpg');

  /** Minimum file size in bytes (default: 0) */
  public readonly minSize = input<number>(0);

  /** Maximum file size per image in bytes (default: 2MB) */
  public readonly maxSize = input<number>(2 * 1024 * 1024);

  /** Button text */
  public readonly buttonText = input<string>('Upload image');

  /** Button variant */
  public readonly buttonVariant = input<
    'default' | 'outline' | 'secondary' | 'ghost'
  >('default');

  /** Show icon button */
  public readonly showIcon = input<boolean>(true);

  /** Text to show when no image is attached */
  public readonly emptyText = input<string>('No image attached');

  /** Additional class names */
  public readonly userClass = input<ClassValue>('');

  /** Reference to the file input element */
  private readonly fileInput =
    viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Uploaded image */
  protected readonly image = signal<SingleImageUploadValue | null>(null);

  /** Disabled state */
  protected readonly _disabled = signal<boolean>(false);

  /** Current validation errors */
  private readonly _validationErrors = signal<ValidationErrors | null>(null);

  /** Computed class */
  protected readonly _computedClass = computed(() =>
    hlm('w-full', this.userClass()),
  );

  // ControlValueAccessor implementation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onChange: (value: SingleImageUploadValue | null) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onTouched: () => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onValidatorChange: () => void = () => {};

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Read and set the file first (show preview even if validation fails)
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const newImage: SingleImageUploadValue = {
        filename: file.name,
        mime: file.type,
        size: file.size,
        base64: result,
      };

      // Show the preview
      this.image.set(newImage);

      // Validate file type
      const acceptedTypes = this.accept()
        .split(',')
        .map((t) => t.trim());
      if (!acceptedTypes.includes(file.type)) {
        this._validationErrors.set({
          fileType: {
            accepted: acceptedTypes,
            actual: file.type,
          },
        });
        // Keep the image value so required validation doesn't trigger
        this._onChange(newImage);
        this._onTouched();
        this._onValidatorChange();
        input.value = '';
        return;
      }

      // Validate file size
      if (file.size < this.minSize()) {
        this._validationErrors.set({
          minSize: {
            required: this.minSize(),
            actual: file.size,
          },
        });
        // Keep the image value so required validation doesn't trigger
        this._onChange(newImage);
        this._onTouched();
        this._onValidatorChange();
        input.value = '';
        return;
      }

      if (file.size > this.maxSize()) {
        this._validationErrors.set({
          maxSize: {
            required: this.maxSize(),
            actual: file.size,
          },
        });
        // Keep the image value so required validation doesn't trigger
        this._onChange(newImage);
        this._onTouched();
        this._onValidatorChange();
        input.value = '';
        return;
      }

      // Clear errors and update with valid image
      this._validationErrors.set(null);
      this._onChange(newImage);
      this._onTouched();
      this._onValidatorChange();
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  removeImage(): void {
    this.image.set(null);
    this._validationErrors.set(null);
    this._onChange(null);
    this._onTouched();
    this._onValidatorChange();

    // Reset the file input
    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.value = '';
    }
  }

  // ControlValueAccessor methods
  writeValue(value: SingleImageUploadValue | null): void {
    if (value && typeof value === 'object' && 'base64' in value) {
      this.image.set(value);
    } else {
      this.image.set(null);
    }
    this._validationErrors.set(null);
  }

  registerOnChange(fn: (value: SingleImageUploadValue | null) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled.set(isDisabled);
  }

  // Validator methods
  validate(_control: AbstractControl): ValidationErrors | null {
    return this._validationErrors();
  }

  registerOnValidatorChange(fn: () => void): void {
    this._onValidatorChange = fn;
  }
}
