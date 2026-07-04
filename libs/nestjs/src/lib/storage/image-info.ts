import { imageSize } from 'image-size';

/**
 * Image dimensions extracted from a header (STORY-0803, TASK-2431).
 */
export interface ImageInfo {
  width: number;
  height: number;
  /** The `image-size` format id, e.g. `png` / `jpg` / `gif` / `webp`. */
  type: string;
}

/**
 * Dimensions from an image header. Returns `undefined` when `head` is not a
 * recognized image or is too short to carry the dimension box. Never throws.
 *
 * Backed by `image-size` (pure-JS, header-only — no pixel decode, so a
 * decompression/pixel-bomb cannot blow up memory here) and fed only the bounded
 * head buffer the caller already peeks for sniffing (`SNIFF_BYTES`). For the
 * common web set (JPEG/PNG/GIF/WebP) the dimension box sits within the first few
 * hundred bytes, so the head window is ample; a format whose box sits past the
 * window is a graceful miss, not an error.
 */
export function imageInfo(head: Buffer): ImageInfo | undefined {
  if (!Buffer.isBuffer(head) || head.length === 0) return undefined;
  try {
    const { width, height, type } = imageSize(head);
    if (
      typeof width === 'number' &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height > 0 &&
      typeof type === 'string' &&
      type.length > 0
    ) {
      return { width, height, type };
    }
    return undefined;
  } catch {
    // Truncated head / unrecognized format → graceful miss.
    return undefined;
  }
}
