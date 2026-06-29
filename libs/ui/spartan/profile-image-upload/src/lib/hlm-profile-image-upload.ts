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
import {
  lucideCamera,
  lucideUpload,
  lucideX,
  lucideUser,
  lucidePencil,
} from '@ng-icons/lucide';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import type { ClassValue } from 'clsx';
import { hlm } from '@openbucket/spartan-ui/utils';
import { toast } from 'ngx-sonner';
import {
  HlmProfilePhotoEdit,
  type PhotoEditResult,
} from './hlm-profile-photo-edit';

export interface ProfileImageUploadValue {
  filename: string;
  mime: string;
  size: number;
  base64: string;
}

export const HLM_PROFILE_IMAGE_UPLOAD_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => HlmProfileImageUpload),
  multi: true,
};

export const HLM_PROFILE_IMAGE_UPLOAD_VALIDATOR = {
  provide: NG_VALIDATORS,
  useExisting: forwardRef(() => HlmProfileImageUpload),
  multi: true,
};

@Component({
  selector: 'hlm-profile-image-upload',
  imports: [HlmIconImports, HlmButtonImports, HlmProfilePhotoEdit],
  providers: [
    HLM_PROFILE_IMAGE_UPLOAD_VALUE_ACCESSOR,
    HLM_PROFILE_IMAGE_UPLOAD_VALIDATOR,
    provideIcons({
      lucideCamera,
      lucideUpload,
      lucideX,
      lucideUser,
      lucidePencil,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '_computedClass()',
  },
  template: `
    <!-- Photo Editor Dialog -->
    <hlm-profile-photo-edit
      [open]="_showPhotoEditor()"
      [imageSource]="_pendingImageUrl()"
      [tabsVariant]="tabsVariant()"
      (openChange)="onPhotoEditorOpenChange($event)"
      (editComplete)="onPhotoEditComplete($event)"
      (editCancelled)="onPhotoEditCancelled()"
      (retakeRequested)="onRetakeRequested()"
    />

    <div class="flex flex-col items-center gap-4">
      <!-- Camera Modal -->
      @if (_showCameraModal()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          (click)="closeCameraModal()"
        >
          <div
            class="relative flex max-h-[90vh] max-w-2xl flex-col gap-4 rounded-lg bg-background p-6 shadow-xl"
            (click)="$event.stopPropagation()"
          >
            <h2 class="text-xl font-semibold">Take a Photo</h2>

            <!-- Video Preview -->
            <div class="relative overflow-hidden rounded-lg bg-black">
              <video
                #videoElement
                autoplay
                playsinline
                class="w-full max-h-[60vh] object-contain"
              ></video>

              <!-- Canvas for capturing (hidden) -->
              <canvas
                #canvasElement
                class="hidden"
              ></canvas>
            </div>

            <!-- Actions -->
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                hlmBtn
                variant="outline"
                (click)="closeCameraModal()"
              >
                <ng-icon
                  name="lucideX"
                  size="16"
                  class="mr-2"
                />
                Cancel
              </button>
              <button
                type="button"
                hlmBtn
                (click)="capturePhoto()"
              >
                <ng-icon
                  name="lucideCamera"
                  size="16"
                  class="mr-2"
                />
                Capture Photo
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Avatar Preview -->
      <div class="relative">
        <!-- Regular file input -->
        <input
          #fileInput
          type="file"
          [accept]="accept()"
          class="hidden"
          (change)="onFileSelected($event)"
          [disabled]="_disabled()"
          (dragover)="onDragOver($event)"
          (drop)="onDrop($event)"
        />

        <!-- Camera capture input -->
        <input
          #cameraInput
          type="file"
          [accept]="accept()"
          capture="user"
          class="hidden"
          (change)="onFileSelected($event)"
          [disabled]="_disabled()"
        />

        <!-- Main Avatar Circle -->
        <button
          type="button"
          class="group relative flex items-center justify-center overflow-hidden rounded-full border-4 border-border bg-muted transition-all hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          [class.size-24]="size() === 'sm'"
          [class.size-32]="size() === 'default'"
          [class.size-40]="size() === 'lg'"
          [class.size-48]="size() === 'xl'"
          [disabled]="_disabled()"
          (click)="!_disabled() && fileInput.click()"
        >
          @if (previewUrl()) {
            <!-- Image Preview -->
            <img
              [src]="previewUrl()"
              [alt]="userName() || 'Profile picture'"
              class="absolute inset-0 size-full object-cover"
            />

            <!-- Hover Overlay -->
            <div
              class="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <div class="flex flex-col items-center gap-1 text-white">
                <ng-icon
                  name="lucideCamera"
                  [size]="
                    size() === 'xl' ? '32' : size() === 'lg' ? '24' : '20'
                  "
                />
                <span class="text-xs font-medium">{{ changeText() }}</span>
              </div>
            </div>
          } @else {
            <!-- Empty State with Initials or Icon -->
            <div
              class="flex size-full flex-col items-center justify-center bg-linear-to-br from-primary/10 to-primary/5"
            >
              @if (initials()) {
                <span
                  class="font-semibold text-primary"
                  [class.text-2xl]="size() === 'sm'"
                  [class.text-3xl]="size() === 'default'"
                  [class.text-4xl]="size() === 'lg'"
                  [class.text-5xl]="size() === 'xl'"
                >
                  {{ initials() }}
                </span>
              } @else {
                <ng-icon
                  name="lucideUser"
                  class="text-primary/50"
                  [size]="
                    size() === 'xl'
                      ? '64'
                      : size() === 'lg'
                        ? '48'
                        : size() === 'default'
                          ? '32'
                          : '24'
                  "
                />
              }

              <!-- Hover Upload Hint with semi-transparent background -->
              <div
                class="absolute inset-0 flex items-center justify-center bg-background/95 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <div class="flex flex-col items-center gap-1">
                  <ng-icon
                    name="lucideUpload"
                    class="text-primary"
                    [size]="
                      size() === 'xl'
                        ? '40'
                        : size() === 'lg'
                          ? '32'
                          : size() === 'default'
                            ? '24'
                            : '20'
                    "
                  />
                  <span
                    class="text-sm font-medium text-primary"
                    [class.text-xs]="size() === 'sm'"
                    >{{ uploadText() }}</span
                  >
                </div>
              </div>
            </div>
          }

          <!-- Drag & Drop Indicator -->
          @if (_isDragging()) {
            <div
              class="absolute inset-0 flex items-center justify-center rounded-full border-4 border-dashed border-primary bg-primary/10"
            >
              <div class="flex flex-col items-center gap-1 text-primary">
                <ng-icon
                  name="lucideUpload"
                  size="32"
                />
                <span class="text-sm font-medium">{{ dropText() }}</span>
              </div>
            </div>
          }
        </button>

        <!-- Remove Button -->
        @if (previewUrl() && showRemoveButton()) {
          <button
            type="button"
            hlmBtn
            variant="destructive"
            size="icon"
            class="absolute -right-1 -top-1 size-8 rounded-full shadow-lg transition-transform hover:scale-110"
            (click)="removeImage(); $event.stopPropagation()"
            [disabled]="_disabled()"
          >
            <ng-icon
              name="lucideX"
              size="16"
            />
          </button>
        }

        <!-- Edit Button -->
        @if (previewUrl() && showEditButton()) {
          <button
            type="button"
            hlmBtn
            variant="secondary"
            size="icon"
            class="absolute -bottom-1 -right-1 size-8 rounded-full shadow-lg transition-transform hover:scale-110"
            (click)="editCurrentImage(); $event.stopPropagation()"
            [disabled]="_disabled()"
            title="Edit photo"
          >
            <ng-icon
              name="lucidePencil"
              size="16"
            />
          </button>
        }

        <!-- Camera Badge (Optional) -->
        @if (!previewUrl() && showCameraBadge()) {
          <button
            type="button"
            class="absolute -bottom-1 -right-1 flex size-10 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            (click)="openCamera(); $event.stopPropagation()"
            [disabled]="_disabled()"
            title="Take photo with camera"
          >
            <ng-icon
              name="lucideCamera"
              size="20"
            />
          </button>
        }
      </div>
    </div>
  `,
})
export class HlmProfileImageUpload implements ControlValueAccessor, Validator {
  /** User's name for generating initials */
  public readonly userName = input<string>('');

  /** Accepted file types */
  public readonly accept = input<string>(
    'image/png,image/jpeg,image/jpg,image/gif',
  );

  /** Minimum file size in bytes (default: 0) */
  public readonly minSize = input<number>(0);

  /** Maximum file size in bytes (default: 5MB) */
  public readonly maxSize = input<number>(5 * 1024 * 1024);

  /** Size variant */
  public readonly size = input<'sm' | 'default' | 'lg' | 'xl'>('lg');

  /** Show remove button when image exists */
  public readonly showRemoveButton = input<boolean>(true);

  /** Show edit button when image exists */
  public readonly showEditButton = input<boolean>(true);

  /** Show camera badge on empty state */
  public readonly showCameraBadge = input<boolean>(true);

  /** Text to display on hover when image exists */
  public readonly changeText = input<string>('Change');

  /** Text to display on hover when empty */
  public readonly uploadText = input<string>('Upload');

  /** Text to display when dragging */
  public readonly dropText = input<string>('Drop here');

  /** Original image URL for editing (higher resolution) */
  public readonly originalImageUrl = input<string | null>(null);

  /** Tabs variant for photo editor */
  public readonly tabsVariant = input<'default' | 'outline'>('default');

  /** Additional class names */
  public readonly userClass = input<ClassValue>('');

  /** Reference to the file input element */
  private readonly fileInput =
    viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Reference to the camera input element */
  private readonly cameraInput =
    viewChild<ElementRef<HTMLInputElement>>('cameraInput');

  /** Reference to video element for camera */
  private readonly videoElement =
    viewChild<ElementRef<HTMLVideoElement>>('videoElement');

  /** Reference to canvas element for capturing */
  private readonly canvasElement =
    viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  /** Preview URL for the uploaded image */
  protected readonly previewUrl = signal<string | null>(null);

  /** Drag state */
  protected readonly _isDragging = signal<boolean>(false);

  /** Disabled state */
  protected readonly _disabled = signal<boolean>(false);

  /** Current validation errors */
  protected readonly _validationErrors = signal<ValidationErrors | null>(null);

  /** Camera modal visibility */
  protected readonly _showCameraModal = signal<boolean>(false);

  /** Active media stream */
  private _mediaStream: MediaStream | null = null;

  /** Photo editor visibility */
  protected readonly _showPhotoEditor = signal<boolean>(false);

  /** Pending image URL for editing */
  protected readonly _pendingImageUrl = signal<string>('');

  /** Computed initials from userName */
  protected readonly initials = computed(() => {
    const name = this.userName();
    if (!name) return '';

    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  });

  /** Computed class */
  protected readonly _computedClass = computed(() =>
    hlm('inline-flex', this.userClass()),
  );

  // ControlValueAccessor implementation
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onChange: (value: ProfileImageUploadValue | null) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onTouched: () => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onValidatorChange: () => void = () => {};

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this._disabled()) {
      this._isDragging.set(true);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this._isDragging.set(false);

    if (this._disabled()) return;

    const file = event.dataTransfer?.files[0];
    if (file) {
      this.processFile(file);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    this.processFile(file);
    input.value = ''; // Reset input
  }

  private processFile(file: File): void {
    // Create preview URL first
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;

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
        this._onChange(null);
        this._onTouched();
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
        this._onChange(null);
        this._onTouched();
        this._onValidatorChange();
        return;
      }

      // Clear errors and open photo editor
      this._validationErrors.set(null);
      this._pendingImageUrl.set(result);
      this._showPhotoEditor.set(true);
    };
    reader.readAsDataURL(file);
  }

  removeImage(): void {
    this.previewUrl.set(null);
    this._validationErrors.set(null);
    this._onChange(null);
    this._onTouched();
    this._onValidatorChange();

    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.value = '';
    }

    const cameraInputEl = this.cameraInput()?.nativeElement;
    if (cameraInputEl) {
      cameraInputEl.value = '';
    }
  }

  /**
   * Open photo editor with current image
   * Uses original high-resolution image if available, otherwise uses preview
   */
  async editCurrentImage(): Promise<void> {
    if (this._disabled()) return;

    const currentPreview = this.previewUrl();
    if (!currentPreview) return;

    // Use original image URL for editing if available (higher resolution)
    const editImageUrl = this.originalImageUrl();

    if (editImageUrl) {
      // Fetch and convert original image to data URL for editing
      try {
        const response = await fetch(editImageUrl);
        const blob = await response.blob();
        const reader = new FileReader();

        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          this._pendingImageUrl.set(dataUrl);
          this._showPhotoEditor.set(true);
        };

        reader.readAsDataURL(blob);
      } catch (error) {
        console.error('Failed to load original image, using preview:', error);
        // Fallback to preview if original fails to load
        this._pendingImageUrl.set(currentPreview);
        this._showPhotoEditor.set(true);
      }
    } else {
      // No original URL available, use preview (might be lower resolution)
      this._pendingImageUrl.set(currentPreview);
      this._showPhotoEditor.set(true);
    }
  }

  /**
   * Open camera to take a photo
   */
  async openCamera(): Promise<void> {
    if (this._disabled()) return;

    // Check if MediaDevices API is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Fallback to file input for mobile devices
      const input = this.cameraInput()?.nativeElement;
      if (input) {
        input.click();
      }
      return;
    }

    try {
      // Request camera access
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });

      // Show modal
      this._showCameraModal.set(true);

      // Wait for view to update and video element to be available
      setTimeout(() => {
        const video = this.videoElement()?.nativeElement;
        if (video && this._mediaStream) {
          video.srcObject = this._mediaStream;
        }
      }, 0);
    } catch (error) {
      console.error('Error accessing camera:', error);
      toast.error('Camera Access Denied', {
        description: 'Please allow camera access to take a photo.',
      });
    }
  }

  /**
   * Capture photo from video stream
   */
  capturePhoto(): void {
    const video = this.videoElement()?.nativeElement;
    const canvas = this.canvasElement()?.nativeElement;

    if (!video || !canvas) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame to canvas
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            // Create a file from the blob
            const file = new File([blob], 'camera-photo.jpg', {
              type: 'image/jpeg',
            });

            // Process the captured photo
            this.processFile(file);

            // Close modal
            this.closeCameraModal();
          }
        },
        'image/jpeg',
        0.95,
      );
    }
  }

  /**
   * Close camera modal and stop stream
   */
  closeCameraModal(): void {
    // Stop all video tracks
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((track) => track.stop());
      this._mediaStream = null;
    }

    // Clear video source
    const video = this.videoElement()?.nativeElement;
    if (video) {
      video.srcObject = null;
    }

    // Hide modal
    this._showCameraModal.set(false);
  }

  /**
   * Handle photo editor open state change
   */
  onPhotoEditorOpenChange(open: boolean): void {
    if (!open) {
      this._showPhotoEditor.set(false);
      this._pendingImageUrl.set('');
    }
  }

  /**
   * Handle photo edit complete
   */
  onPhotoEditComplete(result: PhotoEditResult): void {
    // Set preview URL
    this.previewUrl.set(result.dataUrl);

    // Create value
    const value: ProfileImageUploadValue = {
      filename: result.file.name,
      mime: result.file.type,
      size: result.file.size,
      base64: result.dataUrl,
    };

    this._onChange(value);
    this._onTouched();
    this._onValidatorChange();

    // Close editor
    this._showPhotoEditor.set(false);
    this._pendingImageUrl.set('');
  }

  /**
   * Handle photo edit cancelled
   */
  onPhotoEditCancelled(): void {
    this._showPhotoEditor.set(false);
    this._pendingImageUrl.set('');
  }

  onRetakeRequested(): void {
    // Close photo editor
    this._showPhotoEditor.set(false);
    this._pendingImageUrl.set('');

    // Reopen camera/file picker
    // Check if we can access camera (desktop) or use mobile capture
    if (
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    ) {
      // Desktop: Open camera modal
      void this.openCamera();
    } else {
      // Mobile: Trigger file input with camera capture
      const cameraInputEl = this.cameraInput()?.nativeElement;
      if (cameraInputEl) {
        cameraInputEl.click();
      }
    }
  }

  // ControlValueAccessor methods
  writeValue(value: ProfileImageUploadValue | string | null): void {
    if (value && typeof value === 'object' && 'base64' in value) {
      this.previewUrl.set(value.base64);
    } else if (typeof value === 'string') {
      this.previewUrl.set(value);
    } else {
      this.previewUrl.set(null);
    }
    this._validationErrors.set(null);
  }

  registerOnChange(fn: (value: ProfileImageUploadValue | null) => void): void {
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
