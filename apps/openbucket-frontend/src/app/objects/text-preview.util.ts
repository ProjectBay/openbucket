/**
 * Pure text-preview helpers (STORY-1100 / TASK-3301). Kept out of the component
 * so the byte→string decode and the binary sniff are unit-testable in isolation.
 */

/** Upper bound (bytes) fetched for a text preview via a bounded `Range` request. */
export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024; // 256 KiB

/** How many leading bytes the binary sniff inspects. */
const SNIFF_BYTES = 8 * 1024;

/** Share of non-printable control bytes above which content is treated as binary. */
const NON_PRINTABLE_RATIO = 0.1;

/**
 * Heuristic: a NUL byte in the first 8 KiB, or >10% non-printable control bytes,
 * means the payload is binary and must NOT be dumped as text (so a `.bin`
 * mislabeled `text/plain` doesn't spray control characters into the panel).
 * Bytes ≥ 0x80 are treated as printable (UTF-8 multibyte lead/continuation).
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, SNIFF_BYTES);
  if (n === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return true; // NUL → definitely binary
    if (b === 9 || b === 10 || b === 13) continue; // tab, LF, CR
    if (b >= 0x20) continue; // printable ASCII or UTF-8 high bytes
    nonPrintable++;
  }
  return nonPrintable / n > NON_PRINTABLE_RATIO;
}

/** Decode bytes as UTF-8, replacing invalid sequences rather than throwing. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
