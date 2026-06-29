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
import { lucideUpload, lucideX } from '@ng-icons/lucide';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import type { ClassValue } from 'clsx';
import { hlm } from '@openbucket/spartan-ui/utils';

export interface AvatarUploadValue {
  filename: string;
  mime: string;
  size: number;
  base64: string;
}

export const HLM_AVATAR_UPLOAD_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmAvatarUpload),
  multi: true,
};

export const HLM_AVATAR_UPLOAD_VALIDATOR = {
  provide: NG_VALIDATORS,
  useExisting: forwardRef(() => HlmAvatarUpload),
  multi: true,
};

@Component({
  selector: 'hlm-avatar-upload',
  imports: [HlmIconImports, HlmButtonImports],
  providers: [
    HLM_AVATAR_UPLOAD_VALUE_ACCESSOR,
    HLM_AVATAR_UPLOAD_VALIDATOR,
    provideIcons({ lucideUpload, lucideX }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '_computedClass()',
  },
  template: `
    <div class="inline-flex flex-col items-center">
      <!-- Avatar wrapper -->
      <div class="relative overflow-visible">
        <input
          #fileInput
          type="file"
          [accept]="accept()"
          [attr.max-size]="maxSize()"
          class="hidden"
          (change)="onFileSelected($event)"
          [disabled]="_disabled()"
        />

        <button
          type="button"
          hlmBtn
          variant="ghost"
          size="icon"
          class="relative flex items-center justify-center overflow-hidden rounded-full p-0 shrink-0! leading-none"
          [class.size-20]="size() === 'default'"
          [class.size-24]="size() === 'lg'"
          [class.size-16]="size() === 'sm'"
          (click)="!_disabled() && fileInput.click()"
          [disabled]="_disabled()"
        >
          @if (previewUrl()) {
            <!-- Image preview -->
            <img
              [src]="previewUrl()"
              [alt]="alt()"
              class="absolute inset-0 size-full object-cover rounded-full"
            />

            <!-- Overlay on hover -->
            <div
              class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100 rounded-full"
            >
              <ng-icon
                name="lucideUpload"
                class="text-white"
                size="20"
              />
            </div>
          } @else {
            <!-- Empty state -->
            <div
              class="flex size-full flex-col items-center justify-center gap-2 rounded-full border-2 border-dashed border-muted-foreground/25 bg-muted/10 transition-colors hover:border-muted-foreground/50 hover:bg-muted/20"
            >
              <ng-icon
                name="lucideUpload"
                class="text-muted-foreground"
                [size]="size() === 'lg' ? '32' : size() === 'sm' ? '16' : '24'"
              />
            </div>
          }
        </button>

        <!-- Remove button -->
        <button
          type="button"
          hlmBtn
          variant="destructive"
          size="icon"
          class="absolute -right-1 -top-1 size-6 rounded-full transition-opacity"
          [class.opacity-0]="!previewUrl() || !showRemoveButton()"
          [class.pointer-events-none]="!previewUrl() || !showRemoveButton()"
          [class.opacity-100]="previewUrl() && showRemoveButton()"
          (click)="removeImage()"
          [disabled]="_disabled()"
        >
          <ng-icon
            name="lucideX"
            size="12"
          />
        </button>
      </div>

      <!-- Optional text below -->
      @if (uploadText() || uploadHint()) {
        <div class="mt-2 text-center">
          @if (uploadText()) {
            <p class="text-sm font-medium">{{ uploadText() }}</p>
          }
          @if (uploadHint()) {
            <p class="text-xs text-muted-foreground">{{ uploadHint() }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class HlmAvatarUpload implements ControlValueAccessor, Validator {
  /** Alternative text for the image */
  public readonly alt = input<string>('Avatar');

  /** Accepted file types */
  public readonly accept = input<string>('image/png,image/jpeg,image/jpg');

  /** Minimum file size in bytes (default: 0) */
  public readonly minSize = input<number>(0);

  /** Maximum file size in bytes (default: 2MB) */
  public readonly maxSize = input<number>(2 * 1024 * 1024);

  /** Size variant of the avatar */
  public readonly size = input<'sm' | 'default' | 'lg'>('default');

  /** Show remove button when image is uploaded */
  public readonly showRemoveButton = input<boolean>(true);

  /** Text to display below the avatar */
  public readonly uploadText = input<string>('Upload avatar');

  /** Hint text to display below */
  public readonly uploadHint = input<string>('PNG, JPG up to 2MB');

  /** Initials to show in fallback */
  public readonly initials = input<string>('');

  /** Additional class names */
  // eslint-disable-next-line @angular-eslint/no-input-rename
  public readonly userClass = input<ClassValue>('', { alias: 'class' });

  /** Reference to the file input element */
  private readonly fileInput =
    viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Preview URL for the uploaded image */
  protected readonly previewUrl = signal<string | null>(null);

  /** Disabled state */
  protected readonly _disabled = signal<boolean>(false);

  /** Current validation errors */
  private readonly _validationErrors = signal<ValidationErrors | null>(null);

  /** Computed class */
  protected readonly _computedClass = computed(() => hlm(this.userClass()));

  // ControlValueAccessor implementation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onChange: (value: AvatarUploadValue | null) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onTouched: () => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onValidatorChange: () => void = () => {};

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    // Create preview URL first (always show the image)
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      this.previewUrl.set(result);

      // Validate file size
      if (file.size < this.minSize()) {
        this._validationErrors.set({
          minSize: {
            required: this.minSize(),
            actual: file.size,
          },
        });
        this._onChange(null);
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
        this._onChange(null);
        this._onTouched();
        this._onValidatorChange();
        input.value = '';
        return;
      }

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
        this._onChange(null);
        this._onTouched();
        this._onValidatorChange();
        input.value = '';
        return;
      }

      // Clear any previous errors
      this._validationErrors.set(null);

      // Create value object with metadata
      const value: AvatarUploadValue = {
        filename: file.name,
        mime: file.type,
        size: file.size,
        base64: result,
      };

      this._onChange(value);
      this._onTouched();
      this._onValidatorChange();
      // Reset input after successful read to allow selecting the same file again later
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  removeImage(): void {
    this.previewUrl.set(null);
    this._validationErrors.set(null);
    this._onChange(null);
    this._onTouched();
    this._onValidatorChange();

    // Reset the file input to allow selecting the same file again
    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.value = '';
    }
  }

  // ControlValueAccessor methods
  writeValue(value: AvatarUploadValue | string | null): void {
    if (value && typeof value === 'object' && 'base64' in value) {
      // Handle AvatarUploadValue object
      this.previewUrl.set(value.base64);
    } else if (typeof value === 'string') {
      // Handle direct base64 string (for backward compatibility)
      this.previewUrl.set(value);
    } else {
      this.previewUrl.set(null);
    }
    this._validationErrors.set(null);
  }

  registerOnChange(fn: (value: AvatarUploadValue | null) => void): void {
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
