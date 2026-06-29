import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { provideIcons } from '@ng-icons/core';
import {
  lucideRotateCw,
  lucideFlipHorizontal,
  lucideZoomIn,
  lucideZoomOut,
  lucideCrop,
  lucideCheck,
  lucideX,
  lucideChevronLeft,
  lucideChevronRight,
  lucideSun,
  lucideContrast,
  lucideImage,
  lucideDroplet,
  lucideCamera,
  lucideCircle,
} from '@ng-icons/lucide';
import { HlmCheckboxImports } from '@openbucket/spartan-ui/checkbox';
import { HlmRadioGroupImports } from '@openbucket/spartan-ui/radio-group';
import { HlmIconImports } from '@openbucket/spartan-ui/icon';
import { HlmButtonImports } from '@openbucket/spartan-ui/button';
import { HlmSliderImports } from '@openbucket/spartan-ui/slider';
import { HlmDialogImports } from '@openbucket/spartan-ui/dialog';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmTabsImports } from '@openbucket/spartan-ui/tabs';

export interface PhotoEditResult {
  dataUrl: string;
  file: File;
}

export type EditStep = 'crop' | 'adjust' | 'filters';

@Component({
  selector: 'hlm-profile-photo-edit',
  imports: [
    TranslateModule,
    BrnDialogImports,
    HlmIconImports,
    HlmButtonImports,
    HlmSliderImports,
    HlmDialogImports,
    HlmCheckboxImports,
    HlmTabsImports,
    HlmRadioGroupImports,
  ],
  providers: [
    provideIcons({
      lucideRotateCw,
      lucideFlipHorizontal,
      lucideZoomIn,
      lucideZoomOut,
      lucideCrop,
      lucideCheck,
      lucideX,
      lucideChevronLeft,
      lucideChevronRight,
      lucideSun,
      lucideContrast,
      lucideImage,
      lucideDroplet,
      lucideCamera,
      lucideCircle,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-dialog
      [state]="open() ? 'open' : 'closed'"
      (stateChanged)="onStateChange($event)"
    >
      <hlm-dialog-overlay />
      <hlm-dialog-content
        class="sm:max-w-[1200px]! sm:min-w-[900px] p-0 gap-0"
        *brnDialogContent
      >
        <hlm-dialog-header class="px-4 sm:px-6 pt-6 pb-4">
          <h3 hlmDialogTitle>{{ 'profilePhotoEdit.title' | translate }}</h3>
          <p hlmDialogDescription>
            {{ 'profilePhotoEdit.description' | translate }}
          </p>
        </hlm-dialog-header>

        <div
          class="flex flex-col lg:flex-row gap-4 lg:gap-6 px-4 sm:px-6 pb-6 overflow-hidden"
        >
          <!-- Canvas Preview Area -->
          <div
            class="w-full lg:w-auto flex flex-col gap-3"
            #previewContainer
          >
            <div
              class="relative bg-muted rounded-lg overflow-hidden w-full max-w-[350px] aspect-square mx-auto lg:mx-0"
            >
              <canvas
                #canvas
                class="w-full h-full object-contain"
                style="display: block;"
              ></canvas>
            </div>
          </div>

          <!-- Edit Controls Tabs -->
          <div
            class="w-full lg:w-[450px] lg:flex-1 flex flex-col lg:max-h-[350px]"
          >
            <hlm-tabs
              [tab]="currentStepSignal()"
              (tabActivated)="onTabActivated($event)"
              class="flex flex-col h-full overflow-hidden w-full"
            >
              <hlm-paginated-tabs-list
                class="w-full shrink-0"
                [tabListClass]="
                  tabsVariant() === 'outline' ? 'bg-transparent gap-1' : ''
                "
              >
                <button hlmTabsTrigger="crop">
                  {{ 'profilePhotoEdit.tabs.crop' | translate }}
                </button>
                <button hlmTabsTrigger="adjust">
                  {{ 'profilePhotoEdit.tabs.adjustments' | translate }}
                </button>
                <button hlmTabsTrigger="filters">
                  {{ 'profilePhotoEdit.tabs.filters' | translate }}
                </button>
              </hlm-paginated-tabs-list>

              <!-- Crop Tab Content -->
              <div
                hlmTabsContent="crop"
                class="mt-4 overflow-y-auto flex-1 lg:max-h-[290px]"
              >
                <div class="space-y-4 pr-2">
                  <!-- Zoom Control -->
                  <div class="space-y-2">
                    <label
                      class="text-sm font-medium flex items-center gap-2"
                    >
                      <ng-icon
                        name="lucideZoomIn"
                        size="16"
                      />
                      {{ 'profilePhotoEdit.controls.zoom' | translate }}: {{ zoom() }}%
                    </label>
                    <hlm-slider
                      [value]="zoom()"
                      [min]="50"
                      [max]="200"
                      [step]="5"
                      (valueChange)="onZoomChange($event)"
                    />
                  </div>

                  <!-- Rotation -->
                  <div class="flex gap-2">
                    <button
                      type="button"
                      hlmBtn
                      variant="outline"
                      class="flex-1"
                      (click)="rotate(-90)"
                    >
                      <ng-icon
                        name="lucideRotateCw"
                        size="16"
                        class="mr-2 transform scale-x-[-1]"
                      />
                      {{ 'profilePhotoEdit.controls.rotateLeft' | translate }}
                    </button>
                    <button
                      type="button"
                      hlmBtn
                      variant="outline"
                      class="flex-1"
                      (click)="rotate(90)"
                    >
                      <ng-icon
                        name="lucideRotateCw"
                        size="16"
                        class="mr-2"
                      />
                      {{ 'profilePhotoEdit.controls.rotateRight' | translate }}
                    </button>
                  </div>

                  <!-- Flip -->
                  <button
                    type="button"
                    hlmBtn
                    variant="outline"
                    class="w-full"
                    (click)="flipHorizontal()"
                  >
                    <ng-icon
                      name="lucideFlipHorizontal"
                      size="16"
                      class="mr-2"
                    />
                    {{ 'profilePhotoEdit.controls.flipHorizontal' | translate }}
                  </button>

                  <!-- Background Options -->
                  <div class="pt-4 mt-1 border-t space-y-3">
                    <label class="text-sm font-medium flex items-center gap-2">
                      <ng-icon name="lucideImage" size="16" />
                      {{ 'profilePhotoEdit.controls.backgroundStyle' | translate }}
                    </label>
                    <hlm-radio-group
                      [value]="backgroundStyle()"
                      (valueChange)="onBackgroundStyleChange($event)"
                      class="space-y-2"
                    >
                      <div class="flex items-center gap-2">
                        <hlm-radio value="blur" id="bg-blur">
                          <hlm-radio-indicator />
                        </hlm-radio>
                        <label
                          for="bg-blur"
                          class="text-sm font-medium leading-none cursor-pointer"
                        >
                          {{ 'profilePhotoEdit.controls.blurBackground' | translate }}
                        </label>
                      </div>
                      <div class="flex items-center gap-2">
                        <hlm-radio value="white" id="bg-white">
                          <hlm-radio-indicator />
                        </hlm-radio>
                        <label
                          for="bg-white"
                          class="text-sm font-medium leading-none cursor-pointer flex items-center gap-1.5"
                        >
                          {{ 'profilePhotoEdit.controls.whiteBackground' | translate }}
                          <div class="w-4 h-4 rounded-full border-2 border-border bg-white"></div>
                        </label>
                      </div>
                      <div class="flex items-center gap-2">
                        <hlm-radio value="black" id="bg-black">
                          <hlm-radio-indicator />
                        </hlm-radio>
                        <label
                          for="bg-black"
                          class="text-sm font-medium leading-none cursor-pointer flex items-center gap-1.5"
                        >
                          {{ 'profilePhotoEdit.controls.blackBackground' | translate }}
                          <div class="w-4 h-4 rounded-full border-2 border-border bg-black"></div>
                        </label>
                      </div>
                    </hlm-radio-group>
                  </div>
                </div>
              </div>

              <!-- Adjustments Tab Content -->
              <div
                hlmTabsContent="adjust"
                class="mt-4 overflow-y-auto flex-1 lg:max-h-[290px]"
              >
                <div class="space-y-4 pr-2">
                  <!-- Brightness -->
                  <div class="space-y-2">
                    <label
                      class="text-sm font-medium flex items-center gap-2"
                    >
                      <ng-icon
                        name="lucideSun"
                        size="16"
                      />
                      {{ 'profilePhotoEdit.controls.brightness' | translate }}:
                      {{ brightness() }}
                    </label>
                    <hlm-slider
                      [value]="brightness()"
                      [min]="-100"
                      [max]="100"
                      [step]="5"
                      (valueChange)="onBrightnessChange($event)"
                    />
                  </div>

                  <!-- Contrast -->
                  <div class="space-y-2">
                    <label
                      class="text-sm font-medium flex items-center gap-2"
                    >
                      <ng-icon
                        name="lucideContrast"
                        size="16"
                      />
                      {{ 'profilePhotoEdit.controls.contrast' | translate }}:
                      {{ contrast() }}
                    </label>
                    <hlm-slider
                      [value]="contrast()"
                      [min]="-100"
                      [max]="100"
                      [step]="5"
                      (valueChange)="onContrastChange($event)"
                    />
                  </div>

                  <!-- Saturation -->
                  <div class="space-y-2">
                    <label
                      class="text-sm font-medium flex items-center gap-2"
                    >
                      <ng-icon
                        name="lucideDroplet"
                        size="16"
                      />
                      {{ 'profilePhotoEdit.controls.saturation' | translate }}:
                      {{ saturation() }}
                    </label>
                    <hlm-slider
                      [value]="saturation()"
                      [min]="-100"
                      [max]="100"
                      [step]="5"
                      (valueChange)="onSaturationChange($event)"
                    />
                  </div>
                </div>
              </div>

              <!-- Filters Tab Content -->
              <div
                hlmTabsContent="filters"
                class="mt-4 overflow-y-auto flex-1 lg:max-h-[290px]"
              >
                <div class="grid grid-cols-3 gap-2 pr-2">
                  @for (filter of filters; track filter.name) {
                    <button
                      type="button"
                      class="relative h-12 rounded-md border-2 transition-all overflow-hidden hover:border-primary/50"
                      [class.border-primary]="
                        selectedFilter() === filter.name
                      "
                      [class.border-border]="selectedFilter() !== filter.name"
                      (click)="applyFilter(filter.name)"
                    >
                      <div
                        class="absolute inset-0 flex items-center justify-center text-xs font-medium bg-background/80 px-1"
                      >
                        {{ 'profilePhotoEdit.filters.' + filter.name | translate }}
                      </div>
                    </button>
                  }
                </div>
              </div>
            </hlm-tabs>
          </div>
        </div>

        <!-- Footer Actions -->
        <hlm-dialog-footer
          class="px-4 sm:px-6 py-5 flex-row justify-between gap-2 border-t mt-2"
        >
          <button
            type="button"
            hlmBtn
            variant="outline"
            (click)="cancel()"
          >
            <ng-icon
              name="lucideX"
              size="16"
              class="mr-2"
            />
            {{ 'profilePhotoEdit.actions.cancel' | translate }}
          </button>

          <div class="flex gap-2">
            <button
              type="button"
              hlmBtn
              variant="outline"
              (click)="retake()"
            >
              <ng-icon
                name="lucideCamera"
                size="16"
                class="mr-2"
              />
              {{ 'profilePhotoEdit.actions.retake' | translate }}
            </button>
            <button
              type="button"
              hlmBtn
              (click)="save()"
            >
              <ng-icon
                name="lucideCheck"
                size="16"
                class="mr-2"
              />
              {{ 'profilePhotoEdit.actions.save' | translate }}
            </button>
          </div>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </brn-dialog>
  `,
})
export class HlmProfilePhotoEdit {
  /** Dialog open state */
  public readonly open = input<boolean>(false);

  /** Image source to edit */
  public readonly imageSource = input.required<string>();

  /** Tabs variant */
  public readonly tabsVariant = input<'default' | 'outline'>('default');

  /** Dialog open state change */
  public readonly openChange = output<boolean>();

  /** Edit complete with result */
  public readonly editComplete = output<PhotoEditResult>();

  /** Edit cancelled */
  public readonly editCancelled = output<void>();

  /** Retake photo requested */
  public readonly retakeRequested = output<void>();

  /** Canvas reference */
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly currentStepSignal = signal<EditStep>('crop');
  protected readonly zoom = signal<number>(100);
  protected readonly rotation = signal<number>(0);
  protected readonly isFlipped = signal<boolean>(false);
  protected readonly brightness = signal<number>(0);
  protected readonly contrast = signal<number>(0);
  protected readonly saturation = signal<number>(0);
  protected readonly selectedFilter = signal<string>('none');
  protected readonly backgroundStyle = signal<'blur' | 'white' | 'black'>(
    'blur',
  );

  protected readonly filters = [
    { name: 'none', label: 'Original' },
    { name: 'grayscale', label: 'Grayscale' },
    { name: 'sepia', label: 'Sepia' },
    { name: 'invert', label: 'Invert' },
    { name: 'blur', label: 'Blur' },
    { name: 'warm', label: 'Warm' },
  ];

  private _originalImage: HTMLImageElement | null = null;

  constructor() {
    effect(() => {
      const src = this.imageSource();
      if (src) {
        this.loadImage(src);
      }
    });

    effect(() => {
      this.zoom();
      this.rotation();
      this.isFlipped();
      this.brightness();
      this.contrast();
      this.saturation();
      this.selectedFilter();
      this.backgroundStyle();
      this.renderImage();
    });
  }

  private loadImage(src: string): void {
    const img = new Image();
    img.onload = () => {
      this._originalImage = img;
      this.renderImage();
    };
    img.src = src;
  }

  private renderImage(): void {
    const canvasEl = this.canvas()?.nativeElement;
    if (!canvasEl || !this._originalImage) return;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const size = Math.max(canvasEl.clientWidth, 300);
    canvasEl.width = size;
    canvasEl.height = size;

    ctx.clearRect(0, 0, size, size);

    const bgStyle = this.backgroundStyle();
    if (bgStyle === 'blur') {
      ctx.save();
      ctx.filter = 'blur(20px) brightness(0.7)';
      ctx.drawImage(this._originalImage, 0, 0, size, size);
      ctx.restore();
    } else if (bgStyle === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
    } else if (bgStyle === 'black') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);
    }

    ctx.save();

    ctx.translate(size / 2, size / 2);
    ctx.rotate((this.rotation() * Math.PI) / 180);
    if (this.isFlipped()) {
      ctx.scale(-1, 1);
    }
    const scale = this.zoom() / 100;
    ctx.scale(scale, scale);

    const imgRatio = this._originalImage.width / this._originalImage.height;
    let drawWidth = size;
    let drawHeight = size;

    if (imgRatio > 1) {
      drawHeight = size / imgRatio;
    } else {
      drawWidth = size * imgRatio;
    }

    ctx.filter = this.getFilterString();

    ctx.drawImage(
      this._originalImage,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight,
    );

    ctx.restore();
  }

  private getFilterString(): string {
    const filters: string[] = [];

    if (this.brightness() !== 0) {
      const value = 1 + this.brightness() / 100;
      filters.push(`brightness(${value})`);
    }

    if (this.contrast() !== 0) {
      const value = 1 + this.contrast() / 100;
      filters.push(`contrast(${value})`);
    }

    if (this.saturation() !== 0) {
      const value = 1 + this.saturation() / 100;
      filters.push(`saturate(${value})`);
    }

    switch (this.selectedFilter()) {
      case 'grayscale':
        filters.push('grayscale(100%)');
        break;
      case 'sepia':
        filters.push('sepia(100%)');
        break;
      case 'invert':
        filters.push('invert(100%)');
        break;
      case 'blur':
        filters.push('blur(2px)');
        break;
      case 'warm':
        filters.push('sepia(30%) saturate(1.2)');
        break;
    }

    return filters.length > 0 ? filters.join(' ') : 'none';
  }

  protected onOpenChange(open: boolean): void {
    this.openChange.emit(open);
    if (!open) {
      this.reset();
    }
  }

  protected onStateChange(state: 'open' | 'closed'): void {
    const isOpen = state === 'open';
    this.openChange.emit(isOpen);
    if (!isOpen) {
      this.reset();
    }
  }

  protected onZoomChange(value: number): void {
    this.zoom.set(value);
  }

  protected rotate(degrees: number): void {
    this.rotation.set((this.rotation() + degrees) % 360);
  }

  protected flipHorizontal(): void {
    this.isFlipped.set(!this.isFlipped());
  }

  protected onBrightnessChange(value: number): void {
    this.brightness.set(value);
  }

  protected onContrastChange(value: number): void {
    this.contrast.set(value);
  }

  protected onSaturationChange(value: number): void {
    this.saturation.set(value);
  }

  protected applyFilter(filterName: string): void {
    this.selectedFilter.set(filterName);
  }

  protected onTabActivated(tab: string): void {
    this.currentStepSignal.set(tab as EditStep);
  }

  protected onBackgroundStyleChange(style: string | undefined): void {
    if (style === 'blur' || style === 'white' || style === 'black') {
      this.backgroundStyle.set(style);
    }
  }

  protected cancel(): void {
    this.editCancelled.emit();
    this.onOpenChange(false);
  }

  protected retake(): void {
    this.retakeRequested.emit();
    this.onOpenChange(false);
  }

  protected async save(): Promise<void> {
    const canvasEl = this.canvas()?.nativeElement;
    if (!canvasEl) return;

    canvasEl.toBlob(
      (blob) => {
        if (blob) {
          const dataUrl = canvasEl.toDataURL('image/jpeg', 0.95);
          const file = new File([blob], 'edited-photo.jpg', {
            type: 'image/jpeg',
          });

          this.editComplete.emit({ dataUrl, file });
          this.onOpenChange(false);
        }
      },
      'image/jpeg',
      0.95,
    );
  }

  private reset(): void {
    this.currentStepSignal.set('crop');
    this.zoom.set(100);
    this.rotation.set(0);
    this.isFlipped.set(false);
    this.brightness.set(0);
    this.contrast.set(0);
    this.saturation.set(0);
    this.selectedFilter.set('none');
    this.backgroundStyle.set('blur');
  }
}
