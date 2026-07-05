import type { Request } from 'express';

import { ObjectsSearchAdminController } from './objects-search-admin.controller';
import {
  decodeSearchCursor,
  encodeSearchCursor,
  type ObjectSearchResult,
  type ObjectService,
} from '../../domain/objects/object.service';
import type { AuditService } from '../audit/audit.service';
import type { ObjectSearchQueryDto } from './dto/object-search-query.dto';

/**
 * TEST-1101 (cases 4, 6, 7) — ObjectsSearchAdminController (§STORY-1101). Asserts
 * the response mapping (Date → ISO string), the audit SHAPE (mode/hasTag/count,
 * never the raw `q`), and the opaque keyset cursor codec's round-trip +
 * tamper-tolerant decode.
 */
function build() {
  const objects = { search: jest.fn() };
  const audit = { emit: jest.fn() };
  const ctrl = new ObjectsSearchAdminController(
    objects as unknown as ObjectService,
    audit as unknown as AuditService,
  );
  return { objects, audit, ctrl };
}

const reqWith = (): Request =>
  ({
    user: { username: 'admin' },
    openbucket: { requestId: 'req-1' },
  }) as unknown as Request;

describe('ObjectsSearchAdminController (TEST-1101)', () => {
  it('maps hits to the response shape (lastModified → ISO) and forwards the cursor', async () => {
    const { objects, ctrl } = build();
    const page: ObjectSearchResult = {
      results: [
        {
          bucket: 'b1',
          key: 'a/b.txt',
          size: 3,
          etag: 'e',
          lastModified: new Date('2026-01-01T00:00:00.000Z'),
          storageClass: 'STANDARD',
          contentType: 'text/plain',
        },
      ],
      isTruncated: true,
      nextCursor: 'CURSOR',
    };
    objects.search.mockResolvedValue(page);

    const q = { q: 'a', mode: 'prefix', limit: 50 } as ObjectSearchQueryDto;
    const res = await ctrl.search(q, reqWith());

    expect(objects.search).toHaveBeenCalledWith({
      q: 'a',
      mode: 'prefix',
      bucket: undefined,
      tagKey: undefined,
      tagValue: undefined,
      cursor: undefined,
      limit: 50,
    });
    expect(res).toEqual({
      results: [
        {
          bucket: 'b1',
          key: 'a/b.txt',
          size: 3,
          etag: 'e',
          lastModified: '2026-01-01T00:00:00.000Z',
          storageClass: 'STANDARD',
          contentType: 'text/plain',
        },
      ],
      isTruncated: true,
      nextCursor: 'CURSOR',
    });
  });

  it('audits the search SHAPE (mode, hasTag, count) and never the raw q', async () => {
    const { objects, audit, ctrl } = build();
    const hit = {
      bucket: 'b',
      key: 'k',
      size: 1,
      etag: 'e',
      lastModified: new Date('2026-01-01T00:00:00.000Z'),
      storageClass: 'STANDARD',
    };
    objects.search.mockResolvedValue({ results: [hit, { ...hit }], isTruncated: false });

    const q = {
      q: 'secret-key-fragment',
      mode: 'contains',
      tagKey: 'env',
      tagValue: 'prod',
      limit: 50,
    } as ObjectSearchQueryDto;
    await ctrl.search(q, reqWith());

    const emitted = audit.emit.mock.calls[0][0];
    expect(emitted).toEqual({
      event: 'object.searched',
      subject: 'admin',
      mode: 'contains',
      hasTag: true,
      count: 2,
      requestId: 'req-1',
    });
    // The raw term must not leak into the audit record.
    expect(JSON.stringify(emitted)).not.toContain('secret-key-fragment');
  });

  it('cursor codec: round-trips (bucket, key) and tolerates a malformed cursor', () => {
    const enc = encodeSearchCursor('bucket-x', 'deep/key/y');
    expect(decodeSearchCursor(enc)).toEqual({ bucket: 'bucket-x', key: 'deep/key/y' });
    // Tamper-tolerant: garbage / absent → treated as "no cursor" (start from top).
    expect(decodeSearchCursor('!!!not-base64!!!')).toBeUndefined();
    expect(decodeSearchCursor(undefined)).toBeUndefined();
    expect(decodeSearchCursor(Buffer.from('{"b":1}', 'utf8').toString('base64url'))).toBeUndefined();
  });
});
