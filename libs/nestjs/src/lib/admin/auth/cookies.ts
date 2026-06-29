import type { Request } from 'express';

/**
 * Read a single cookie value from the raw `Cookie` header.
 *
 * The admin auth routes are the only ones that read cookies, so rather than pull
 * in `cookie-parser` (and populate `req.cookies` app-wide), the refresh/logout
 * handlers parse the one cookie they need from the header directly. The refresh
 * token is base64url, so it never needs percent-decoding, but we decode anyway to
 * match standard cookie semantics.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}
