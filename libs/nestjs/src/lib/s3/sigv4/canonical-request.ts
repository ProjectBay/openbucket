/**
 * SigV4 canonical request builder (WHITEPAPER §2.4.5).
 *
 * Pure functions (no Nest deps) consumed by both the header path
 * (`Sigv4Verifier`) and the presigned path (`verifyPresigned`, STORY-0104).
 */
export interface CanonicalRequestInput {
  method: string;
  pathname: string; // already URL-decoded once
  query: string; // raw query, no leading '?'
  headers: Record<string, string | string[] | undefined>;
  signedHeaders: string[]; // lowercase, alpha-sorted
  payloadHash: string;
}

export function buildCanonicalRequest(c: CanonicalRequestInput): string {
  // 1. CanonicalURI: S3 uses single-pass URI encoding of each path segment.
  const canonicalUri = c.pathname
    .split('/')
    .map((seg) => awsUriEncode(seg, false))
    .join('/');

  // 2. CanonicalQueryString: sort by key, then by value; URI-encode both.
  const canonicalQuery = canonicaliseQuery(c.query);

  // 3. CanonicalHeaders: each signed header, lower-cased name, trimmed value,
  //    sequential whitespace collapsed, terminated with '\n'.
  const headerLines: string[] = [];
  for (const name of c.signedHeaders) {
    const raw = c.headers[name];
    const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
    const collapsed = value.trim().replace(/\s+/g, ' ');
    headerLines.push(`${name.toLowerCase()}:${collapsed}\n`);
  }

  const signedHeadersLine = c.signedHeaders.map((h) => h.toLowerCase()).join(';');

  return [
    c.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    headerLines.join(''),
    signedHeadersLine,
    c.payloadHash,
  ].join('\n');
}

export function canonicaliseQuery(q: string): string {
  if (!q) return '';
  const params: Array<[string, string]> = [];
  for (const segment of q.split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    const k = eq === -1 ? segment : segment.slice(0, eq);
    const v = eq === -1 ? '' : segment.slice(eq + 1);
    // Per SigV4, the query string is already URL-encoded in the URL. We
    // decode then re-encode to normalise.
    params.push([
      awsUriEncode(decodeURIComponent(k), true),
      awsUriEncode(decodeURIComponent(v), true),
    ]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return params.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * AWS-flavoured RFC 3986: unreserved = ALPHA / DIGIT / '-' / '.' / '_' / '~'.
 * Slashes are preserved in path segments only when `encodeSlash === false`.
 */
export function awsUriEncode(input: string, encodeSlash: boolean): string {
  const out: string[] = [];
  for (const byte of Buffer.from(input, 'utf8')) {
    const c = String.fromCharCode(byte);
    if (
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      c === '-' ||
      c === '_' ||
      c === '.' ||
      c === '~'
    ) {
      out.push(c);
    } else if (c === '/' && !encodeSlash) {
      out.push('/');
    } else {
      out.push('%' + byte.toString(16).toUpperCase().padStart(2, '0'));
    }
  }
  return out.join('');
}
