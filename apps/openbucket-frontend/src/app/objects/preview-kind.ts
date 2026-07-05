import { categoryFor, extOf } from './object-icon';

/**
 * Shared preview-kind classifier (STORY-1100 / TASK-3302). A single pure function
 * decides HOW (and whether) an object can be previewed from its content type,
 * key/extension and size, plus the applicable in-memory byte cap. Both
 * `ObjectPreviewComponent` and the row "Preview" affordance share this one
 * decision instead of two divergent extension maps.
 */

export type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | null;

export interface PreviewDecision {
  kind: PreviewKind;
  /** Byte cap for this kind (0 when not previewable). */
  capBytes: number;
  /** True when a non-text kind exceeds its cap and must not be fetched. */
  overCap: boolean;
}

export const PREVIEW_CAPS = {
  image: 25 * 1024 * 1024, // 25 MiB — browser decodes the whole image
  pdf: 50 * 1024 * 1024, // 50 MiB — matches the previous inline-preview cap
  text: 256 * 1024, // fetched via Range, so this is the display cap
  video: 200 * 1024 * 1024, // streamed with Range, high cap
  audio: 100 * 1024 * 1024,
} as const;

/**
 * `application/*` content types that are really text/code and safe to render in
 * a `<pre>`. `+json` / `+xml` structured-suffix types are handled separately.
 */
const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-javascript',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/x-httpd-php',
  'application/sql',
  'application/toml',
  'application/csv',
  'application/graphql',
]);

/** Strip `; charset=…` params and lower-case (mirrors the server's isActiveContentType). */
function normalizeType(ct: string | undefined): string {
  return (ct ?? '').split(';', 1)[0].trim().toLowerCase();
}

/** A generic/unknown content type where the extension should decide instead. */
function isGeneric(ct: string): boolean {
  return ct === '' || ct === 'application/octet-stream' || ct === 'binary/octet-stream';
}

export function classifyPreview(
  contentType: string | undefined,
  key: string,
  size: number,
): PreviewDecision {
  const ct = normalizeType(contentType);
  let kind: PreviewKind;

  if (isGeneric(ct)) {
    kind = kindFromExtension(key);
  } else if (ct === 'image/svg+xml') {
    // The server forces SVG to attachment/octet-stream, so it never renders inline.
    kind = null;
  } else if (ct.startsWith('image/')) {
    kind = 'image';
  } else if (ct === 'application/pdf') {
    kind = 'pdf';
  } else if (ct.startsWith('text/')) {
    kind = 'text';
  } else if (TEXT_APPLICATION_TYPES.has(ct) || ct.endsWith('+json') || ct.endsWith('+xml')) {
    kind = 'text';
  } else if (ct.startsWith('video/')) {
    kind = 'video';
  } else if (ct.startsWith('audio/')) {
    kind = 'audio';
  } else {
    kind = null;
  }

  if (kind === null) return { kind, capBytes: 0, overCap: false };
  const capBytes = PREVIEW_CAPS[kind];
  // Text is fetched via a Range-bounded head, so the whole-object cap is moot.
  const overCap = kind !== 'text' && size > capBytes;
  return { kind, capBytes, overCap };
}

/** Fall back to the shared extension→category map for generic content types. */
function kindFromExtension(key: string): PreviewKind {
  const ext = extOf(key);
  if (!ext) return null;
  if (ext === 'svg') return null; // never inline SVG (mirrors the content-type rule)
  switch (categoryFor(ext)) {
    case 'image':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'code':
    case 'text':
      return 'text';
    default:
      return null;
  }
}
