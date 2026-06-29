export interface RangeSpec {
  start: number;
  end: number;
}

/**
 * Parse an HTTP/1.1 Range header per RFC 7233 §3.1, restricted to the `bytes`
 * unit and a single range (WHITEPAPER §4.3). Returns `'invalid'` for malformed
 * or unsatisfiable input — the caller emits 416 with the unsatisfied-range
 * Content-Range sentinel (`bytes` `*` slash `<size>`).
 *
 * Accepted: `bytes=A-B` (closed), `bytes=A-` (open-ended), `bytes=-N` (suffix).
 * Rejected (v1): multi-range, non-`bytes` unit, malformed numerals, empty body,
 * `start >= size`. A closed `end` past EOF is clamped to `size - 1`.
 */
export function parseRange(header: string, size: number): RangeSpec | 'invalid' {
  const trimmed = header.trim();
  if (!trimmed.startsWith('bytes=')) return 'invalid';
  const rangesPart = trimmed.slice('bytes='.length);
  if (rangesPart.includes(',')) return 'invalid'; // multi-range: v1 rejects
  const dash = rangesPart.indexOf('-');
  if (dash === -1) return 'invalid';

  const startStr = rangesPart.slice(0, dash);
  const endStr = rangesPart.slice(dash + 1);

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
    if (size === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open-ended.
    start = Number(startStr);
    if (!Number.isInteger(start) || start < 0) return 'invalid';
    if (start >= size) return 'invalid';
    end = size - 1;
  } else if (startStr !== '' && endStr !== '') {
    // Closed.
    start = Number(startStr);
    end = Number(endStr);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return 'invalid';
    if (start < 0 || end < 0 || start > end) return 'invalid';
    if (start >= size) return 'invalid';
    if (end >= size) end = size - 1; // clamp per RFC
  } else {
    return 'invalid';
  }

  return { start, end };
}
