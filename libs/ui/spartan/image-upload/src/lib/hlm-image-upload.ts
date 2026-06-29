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
import { NgClass } from '@angular/common';
import { provideIcons } from '@ng-icons/core';
import { lucideUpload, lucideX, lucideImage } from '@ng-icons/lucide';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import type { ClassValue } from 'clsx';
import { hlm } from '@openbucket/spartan-ui/utils';

export interface ImageUploadValue {
  filename: string;
  mime: string;
  size: number;
  base64: string;
}

export const HLM_IMAGE_UPLOAD_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmImageUpload),
  multi: true,
};

export const HLM_IMAGE_UPLOAD_VALIDATOR = {
  provide: NG_VALIDATORS,
  useExisting: forwardRef(() => HlmImageUpload),
  multi: true,
};

@Component({
  selector: 'hlm-image-upload',
  imports: [NgClass, HlmIconImports, HlmButtonImports],
  providers: [
    HLM_IMAGE_UPLOAD_VALUE_ACCESSOR,
    HLM_IMAGE_UPLOAD_VALIDATOR,
    provideIcons({ lucideUpload, lucideX, lucideImage }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '_computedClass()',
  },
  template: `
		<div class="space-y-4">
			<!-- Preview Grid (if images exist) -->
			@if (images().length > 0) {
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					@for (image of images(); track image.base64) {
						<div class="relative aspect-video rounded-lg overflow-hidden border-2 border-border group">
							<img 
								[src]="image.base64" 
								[alt]="image.filename" 
								class="w-full h-full object-cover"
							/>
							<button
								type="button"
								hlmBtn
								variant="destructive"
								size="icon"
								class="absolute top-1 right-1 size-6 opacity-0 group-hover:opacity-100 transition-opacity"
								(click)="removeImage(image.base64)"
								[disabled]="_disabled()"
							>
								<ng-icon name="lucideX" size="12" />
							</button>
							<div class="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1">
								<p class="text-xs text-white truncate">{{ image.filename }}</p>
								<p class="text-xs text-gray-300">{{ formatSize(image.size) }}</p>
							</div>
						</div>
					}
				</div>
			}

			<!-- Drop Zone -->
			<div
				class="relative border-2 border-dashed rounded-lg transition-colors"
				[ngClass]="{
					'border-muted-foreground/25 bg-muted/10': !isDragging(),
					'border-primary bg-primary/5': isDragging()
				}"
				(dragover)="onDragOver($event)"
				(dragleave)="onDragLeave($event)"
				(drop)="onDrop($event)"
			>
				<input
					#fileInput
					type="file"
					[accept]="accept()"
					[multiple]="maxCount() !== undefined ? maxCount()! > 1 : false"
					class="hidden"
					(change)="onFilesSelected($event)"
					[disabled]="_disabled()"
				/>

				<div class="flex flex-col items-center justify-center py-12 px-6 text-center">
					<!-- Example Images (when empty) -->
					@if (images().length === 0 && showExamples()) {
						<div class="flex gap-2 mb-4 opacity-50">
							@for (i of [1, 2, 3, 4]; track i) {
								<div class="w-16 h-16 bg-muted rounded-lg flex items-center justify-center">
									<ng-icon name="lucideImage" size="24" class="text-muted-foreground" />
								</div>
							}
						</div>
					}

					<ng-icon 
						name="lucideUpload" 
						size="32" 
						class="text-muted-foreground mb-4"
					/>
					
					<h3 class="text-lg font-semibold mb-1">
						{{ uploadTitle() || 'Choose a file or drag & drop here.' }}
					</h3>
					
					<p class="text-sm text-muted-foreground mb-4">
						{{ uploadHint() || getDefaultHint() }}
					</p>

				<button
					type="button"
					hlmBtn
					variant="default"
					(click)="fileInput.click()"
					[disabled]="_disabled()"
				>
					{{ browseButtonText() }}
				</button>

					@if (images().length > 0 && (maxCount() === undefined || maxCount()! > 1)) {
						<p class="text-xs text-muted-foreground mt-2">
							{{ images().length }} / {{ maxCount() === undefined ? 'âˆž' : maxCount() }} images
						</p>
					}
				</div>
			</div>
		</div>
	`,
})
export class HlmImageUpload implements ControlValueAccessor, Validator {
  /** Accepted file types */
  public readonly accept = input<string>('image/png,image/jpeg,image/jpg');

  /** Minimum file size in bytes (default: 0) */
  public readonly minSize = input<number>(0);

  /** Maximum file size per image in bytes (default: 2MB) */
  public readonly maxSize = input<number>(2 * 1024 * 1024);

  /** Maximum total size of all images in bytes (default: 10MB) */
  public readonly maxTotalSize = input<number>(10 * 1024 * 1024);

  /** Minimum number of images required */
  public readonly minCount = input<number>(0);

  /** Maximum number of images allowed (undefined for unlimited) */
  public readonly maxCount = input<number | undefined>(undefined);

  /** Title text for the upload area */
  public readonly uploadTitle = input<string>('');

  /** Hint text for the upload area */
  public readonly uploadHint = input<string>('');

  /** Button text for browsing files */
  public readonly browseButtonText = input<string>('Browse File');

  /** Show example image placeholders when empty */
  public readonly showExamples = input<boolean>(true);

  /** Additional class names */
  public readonly userClass = input<ClassValue>('');

  /** Reference to the file input element */
  private readonly fileInput =
    viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Uploaded images */
  protected readonly images = signal<ImageUploadValue[]>([]);

  /** Dragging state */
  protected readonly isDragging = signal<boolean>(false);

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
  private _onChange: (value: ImageUploadValue[] | null) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onTouched: () => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onValidatorChange: () => void = () => {};

  getDefaultHint(): string {
    const types = this.accept()
      .split(',')
      .map((t) => t.split('/')[1]?.toUpperCase() || t)
      .join(', ');
    const maxSizeMB = (this.maxSize() / 1024 / 1024).toFixed(0);
    return `${types}, up to ${maxSizeMB} MB.`;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this._disabled()) {
      this.isDragging.set(true);
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    if (this._disabled()) {
      return;
    }

    const files = Array.from(event.dataTransfer?.files || []);
    this.processFiles(files);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);

    if (files.length > 0) {
      this.processFiles(files);
    }

    // Reset input to allow selecting the same files again
    input.value = '';
  }

  private processFiles(files: File[]): void {
    const currentImages = this.images();
    const maxCount = this.maxCount();
    const remainingSlots =
      maxCount === undefined ? Infinity : maxCount - currentImages.length;

    if (remainingSlots <= 0) {
      this._validationErrors.set({
        maxCount: {
          required: maxCount,
          actual: currentImages.length + files.length,
        },
      });
      this._onValidatorChange();
      return;
    }

    // Take only as many files as we have slots
    const filesToProcess = files.slice(0, remainingSlots);

    filesToProcess.forEach((file) => {
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
        this._onValidatorChange();
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
        this._onValidatorChange();
        return;
      }

      if (file.size > this.maxSize()) {
        this._validationErrors.set({
          maxSize: {
            required: this.maxSize(),
            actual: file.size,
          },
        });
        this._onValidatorChange();
        return;
      }

      // Read and add the file
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const newImage: ImageUploadValue = {
          filename: file.name,
          mime: file.type,
          size: file.size,
          base64: result,
        };

        const updatedImages = [...this.images(), newImage];

        // Validate total size
        const totalSize = updatedImages.reduce((sum, img) => sum + img.size, 0);
        if (totalSize > this.maxTotalSize()) {
          this._validationErrors.set({
            maxTotalSize: {
              required: this.maxTotalSize(),
              actual: totalSize,
            },
          });
          this._onValidatorChange();
          return;
        }

        // Clear errors and update
        this._validationErrors.set(null);
        this.images.set(updatedImages);
        this._onChange(updatedImages.length > 0 ? updatedImages : null);
        this._onTouched();
        this._onValidatorChange();
      };
      reader.readAsDataURL(file);
    });
  }

  removeImage(base64: string): void {
    const updatedImages = this.images().filter((img) => img.base64 !== base64);
    this.images.set(updatedImages);

    // Validate min count
    if (updatedImages.length < this.minCount() && this.minCount() > 0) {
      this._validationErrors.set({
        minCount: {
          required: this.minCount(),
          actual: updatedImages.length,
        },
      });
    } else {
      this._validationErrors.set(null);
    }

    this._onChange(updatedImages.length > 0 ? updatedImages : null);
    this._onTouched();
    this._onValidatorChange();
  }

  // ControlValueAccessor methods
  writeValue(value: ImageUploadValue[] | null): void {
    if (Array.isArray(value)) {
      this.images.set(value);
    } else {
      this.images.set([]);
    }
    this._validationErrors.set(null);
  }

  registerOnChange(fn: (value: ImageUploadValue[] | null) => void): void {
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
    const images = this.images();

    // Check min count
    if (images.length < this.minCount() && this.minCount() > 0) {
      return {
        minCount: {
          required: this.minCount(),
          actual: images.length,
        },
      };
    }

    // Check max count
    const maxCount = this.maxCount();
    if (maxCount !== undefined && images.length > maxCount) {
      return {
        maxCount: {
          required: maxCount,
          actual: images.length,
        },
      };
    }

    // Check total size
    const totalSize = images.reduce((sum, img) => sum + img.size, 0);
    if (totalSize > this.maxTotalSize()) {
      return {
        maxTotalSize: {
          required: this.maxTotalSize(),
          actual: totalSize,
        },
      };
    }

    return this._validationErrors();
  }

  registerOnValidatorChange(fn: () => void): void {
    this._onValidatorChange = fn;
  }
}
