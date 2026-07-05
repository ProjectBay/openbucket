import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl, SafeUrl } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideFile,
  lucideFileArchive,
  lucideFileAudio,
  lucideFileCode,
  lucideFileText,
  lucideFileVideo,
  lucideImage,
} from '@ng-icons/lucide';
import { ObjectMetaDto } from '@openbucket/api-client';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { HlmButton } from '@openbucket/spartan-ui/button';

import { ByteSizePipe } from '../shared/ui/byte-size.pipe';
import { fileIcon } from './object-icon';
import { classifyPreview, PreviewKind } from './preview-kind';
import { decodeUtf8, looksBinary, TEXT_PREVIEW_MAX_BYTES } from './text-preview.util';

type PreviewState = 'loading' | 'ready' | 'fallback';
type FallbackReason = 'tooLarge' | 'binary' | 'unsupported' | 'error';

/**
 * Sandboxed, signals-based object preview (STORY-1100 / TASK-3300+3301). Owns the
 * blob-URL lifecycle (one place revokes object URLs) and renders image / PDF /
 * text-code (plus video / audio) from an authenticated blob, or a fallback card
 * with a Download affordance when the object is not previewable.
 *
 * Security posture: bytes are read only through the guarded admin `?content`
 * route (STORY-0700 authz + `applySafeObjectResponseHeaders` — CSP, nosniff, and
 * HTML/SVG forced to attachment). The PDF `<iframe sandbox>` (no tokens) blocks
 * scripts/forms/popups/same-origin as defense in depth; text is rendered inert in
 * a `<pre>` via interpolation (never `[innerHTML]`); the per-kind cap
 * ([preview-kind.ts]) is checked BEFORE any fetch so over-cap objects never load.
 */
@Component({
  standalone: true,
  selector: 'ob-object-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, HlmButton, ByteSizePipe, TranslateModule],
  providers: [
    provideIcons({
      lucideDownload,
      lucideFile,
      lucideFileArchive,
      lucideFileAudio,
      lucideFileCode,
      lucideFileText,
      lucideFileVideo,
      lucideImage,
    }),
  ],
  template: `
    @switch (state()) {
      @case ('loading') {
        <p class="text-muted-foreground py-6 text-center">{{ 'objects.previewLoading' | translate }}</p>
      }
      @case ('ready') {
        @switch (kind()) {
          @case ('image') {
            <img
              [src]="imageUrl()"
              [alt]="meta().key"
              class="mx-auto max-h-80 max-w-full rounded border bg-muted/30 object-contain"
            />
          }
          @case ('pdf') {
            <iframe
              [src]="pdfUrl()"
              sandbox
              class="h-96 w-full rounded border"
              title="PDF preview"
            ></iframe>
          }
          @case ('text') {
            @if (truncated()) {
              <p class="text-muted-foreground mb-1 text-xs">{{ 'objects.previewTruncated' | translate }}</p>
            }
            <pre
              class="max-h-96 overflow-auto rounded border bg-muted/30 p-3 text-xs"
            ><code>{{ text() }}</code></pre>
          }
          @case ('video') {
            <video
              [src]="mediaUrl()"
              controls
              class="max-h-80 w-full rounded border bg-black"
            ></video>
          }
          @case ('audio') {
            <audio
              [src]="mediaUrl()"
              controls
              class="w-full"
            ></audio>
          }
        }
      }
      @case ('fallback') {
        <div
          class="flex flex-col items-center gap-2 rounded border bg-muted/30 px-4 py-6 text-center"
        >
          <ng-icon
            [name]="fileIcon(meta().key)"
            class="text-muted-foreground text-4xl"
            aria-hidden="true"
          />
          <p class="text-sm">{{ fallbackMessage() | translate }}</p>
          <p class="text-muted-foreground text-xs">
            {{ meta().size | byteSize }} · {{ meta().contentType }}
          </p>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            (click)="download.emit(meta().key)"
          >
            <ng-icon
              name="lucideDownload"
              class="text-base"
            />
            {{ 'objects.download' | translate }}
          </button>
        </div>
      }
    }
  `,
})
export class ObjectPreviewComponent {
  readonly bucket = input.required<string>();
  readonly meta = input.required<ObjectMetaDto>();

  /** Bubble a download request up to the browser's existing `?download` route. */
  readonly download = output<string>();

  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<PreviewState>('loading');
  readonly kind = signal<PreviewKind>(null);
  readonly imageUrl = signal<SafeUrl | null>(null);
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  readonly mediaUrl = signal<SafeUrl | null>(null);
  readonly text = signal<string | null>(null);
  readonly truncated = signal(false);
  readonly reason = signal<FallbackReason>('unsupported');

  /** The raw blob URL currently in use; revoked on every meta change + on destroy. */
  private objectUrl: string | null = null;
  /** Guards against a stale async response landing after the input changed. */
  private gen = 0;

  protected readonly fileIcon = fileIcon;

  constructor() {
    // Re-run whenever `meta()` changes: revoke the previous blob URL first (fixes
    // the abandoned-URL leak when switching objects), then classify + fetch.
    effect(() => {
      const meta = this.meta();
      this.revoke();
      void this.load(meta);
    });
    this.destroyRef.onDestroy(() => this.revoke());
  }

  fallbackMessage(): string {
    switch (this.reason()) {
      case 'tooLarge':
        return 'objects.previewTooLarge';
      case 'binary':
        return 'objects.previewBinary';
      case 'error':
        return 'objects.previewError';
      default:
        return 'objects.previewUnsupported';
    }
  }

  private async load(meta: ObjectMetaDto): Promise<void> {
    const token = ++this.gen;
    this.reset();
    const decision = classifyPreview(meta.contentType, meta.key, meta.size);
    this.kind.set(decision.kind);
    if (decision.kind === null) return this.fallback('unsupported');
    if (decision.overCap) return this.fallback('tooLarge');

    this.state.set('loading');
    try {
      if (decision.kind === 'text') {
        await this.loadText(meta.key, token);
      } else {
        await this.loadBlob(meta.key, decision.kind, token);
      }
    } catch {
      if (token === this.gen) this.fallback('error');
    }
  }

  /** Bounded (Range-limited) head fetch for text/code; sniff binary, detect truncation. */
  private async loadText(key: string, token: number): Promise<void> {
    const res = await firstValueFrom(
      this.http.get(this.contentUrl(key), {
        responseType: 'arraybuffer',
        headers: { Range: `bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}` },
        observe: 'response',
      }),
    );
    if (token !== this.gen) return;
    const bytes = new Uint8Array(res.body ?? new ArrayBuffer(0));
    if (looksBinary(bytes)) return this.fallback('binary');
    this.text.set(decodeUtf8(bytes));
    this.truncated.set(this.isTruncated(res, bytes.length));
    this.state.set('ready');
  }

  /** Whole-object blob fetch for image / pdf / video / audio (already cap-checked). */
  private async loadBlob(
    key: string,
    kind: Exclude<PreviewKind, 'text' | null>,
    token: number,
  ): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(this.contentUrl(key), { responseType: 'blob' }),
    );
    if (token !== this.gen) return;
    this.objectUrl = URL.createObjectURL(blob);
    if (kind === 'pdf') {
      this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
    } else if (kind === 'image') {
      this.imageUrl.set(this.sanitizer.bypassSecurityTrustUrl(this.objectUrl));
    } else {
      this.mediaUrl.set(this.sanitizer.bypassSecurityTrustUrl(this.objectUrl));
    }
    this.state.set('ready');
  }

  /** A 206 whose reported total exceeds the returned length means content was cut. */
  private isTruncated(res: HttpResponse<ArrayBuffer>, len: number): boolean {
    if (res.status !== 206) return false;
    const total = res.headers.get('Content-Range')?.split('/')[1];
    if (!total || total === '*') return true; // partial, but total unknown → assume more
    return Number(total) > len;
  }

  private fallback(reason: FallbackReason): void {
    this.reason.set(reason);
    this.state.set('fallback');
  }

  private reset(): void {
    this.state.set('loading');
    this.kind.set(null);
    this.imageUrl.set(null);
    this.pdfUrl.set(null);
    this.mediaUrl.set(null);
    this.text.set(null);
    this.truncated.set(false);
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** `encodeURIComponent` exactly once; the controller decodes once (`decodeOnce`). */
  private contentUrl(key: string): string {
    return `/api/admin/buckets/${this.bucket()}/objects/${encodeURIComponent(key)}?content`;
  }
}
