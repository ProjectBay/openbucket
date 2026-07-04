import type { IncomingHttpHeaders } from 'node:http';

import { AccessDeniedError } from '../errors/s3-error';
import { assertMandatorySignedHeaders } from './signed-headers';

/**
 * TASK-2121 / TEST-0702 — mandatory SignedHeaders coverage (finding [8],
 * CWE-345). Verifies the shared helper used by both SigV4 paths rejects a
 * signature that omits `host` or a wire-present `x-amz-*` header.
 */
describe('assertMandatorySignedHeaders', () => {
  const headers: IncomingHttpHeaders = {
    host: 'example.com',
    'x-amz-date': '20260704T000000Z',
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-meta-foo': 'bar',
    'content-type': 'application/octet-stream',
  };

  it('passes when the list covers host and every wire-present x-amz-* header', () => {
    expect(() =>
      assertMandatorySignedHeaders(
        ['host', 'x-amz-date', 'x-amz-content-sha256', 'x-amz-meta-foo'],
        headers,
      ),
    ).not.toThrow();
  });

  it('is case-insensitive on the signed-header names', () => {
    expect(() =>
      assertMandatorySignedHeaders(
        ['Host', 'X-Amz-Date', 'X-Amz-Content-Sha256', 'X-Amz-Meta-Foo'],
        headers,
      ),
    ).not.toThrow();
  });

  it('throws when host is missing from the signed list', () => {
    expect(() =>
      assertMandatorySignedHeaders(
        ['x-amz-date', 'x-amz-content-sha256', 'x-amz-meta-foo'],
        headers,
      ),
    ).toThrow(AccessDeniedError);
  });

  it('throws when a wire-present x-amz-* header is omitted (x-amz-meta-foo)', () => {
    expect(() =>
      assertMandatorySignedHeaders(['host', 'x-amz-date', 'x-amz-content-sha256'], headers),
    ).toThrow(AccessDeniedError);
  });

  it('throws when a wire-present x-amz-content-sha256 header is omitted', () => {
    expect(() =>
      assertMandatorySignedHeaders(['host', 'x-amz-date', 'x-amz-meta-foo'], headers),
    ).toThrow(AccessDeniedError);
  });

  it('ignores undefined header slots (never present on the wire)', () => {
    const sparse: IncomingHttpHeaders = { host: 'h', 'x-amz-trailer': undefined };
    expect(() => assertMandatorySignedHeaders(['host'], sparse)).not.toThrow();
  });

  it('passes a minimal host-only signature when no x-amz-* headers are present', () => {
    expect(() =>
      assertMandatorySignedHeaders(['host'], { host: 'h', 'content-type': 'text/plain' }),
    ).not.toThrow();
  });
});
