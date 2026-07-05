import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ObjectMetaDto } from '@openbucket/api-client';

import { ObjectPreviewComponent } from './object-preview.component';
import { decodeUtf8, looksBinary, TEXT_PREVIEW_MAX_BYTES } from './text-preview.util';

/**
 * TEST-1100 — ObjectPreviewComponent (TASK-3300 + 3301). Covers the image render,
 * the object-URL revoke on object switch, the Range-bounded text fetch +
 * truncation banner, and the binary fallback. Also exercises the pure text-preview
 * helpers.
 *
 * NOTE: aligned with the parked frontend jest harness convention (see
 * object-upload.component.spec.ts); the component is build-verified.
 */
function meta(partial: Partial<ObjectMetaDto>): ObjectMetaDto {
  return {
    key: 'a.txt',
    bucket: 'b1',
    size: 10,
    etag: 'e',
    contentType: 'text/plain',
    lastModified: '2026-01-01T00:00:00.000Z',
    storageClass: 'STANDARD',
    location: 'local',
    ...partial,
  };
}

describe('ObjectPreviewComponent (TEST-1100)', () => {
  let fixture: ComponentFixture<ObjectPreviewComponent>;
  let cmp: ObjectPreviewComponent;
  let http: HttpTestingController;
  let createSpy: jest.SpyInstance;
  let revokeSpy: jest.SpyInstance;
  let urlCounter = 0;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ObjectPreviewComponent, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ObjectPreviewComponent);
    cmp = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    createSpy = jest
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:mock/${++urlCounter}`);
    revokeSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  const setMeta = (m: ObjectMetaDto) => {
    fixture.componentRef.setInput('bucket', m.bucket);
    fixture.componentRef.setInput('meta', m);
    fixture.detectChanges();
  };

  it('renders an image from an authenticated blob', async () => {
    setMeta(meta({ key: 'p.png', contentType: 'image/png', size: 100 }));
    const req = http.expectOne('/api/admin/buckets/b1/objects/p.png?content');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x'], { type: 'image/png' }));
    await Promise.resolve();

    expect(cmp.state()).toBe('ready');
    expect(cmp.kind()).toBe('image');
    expect(cmp.imageUrl()).not.toBeNull();
  });

  it('revokes object A′s blob URL when switching to object B', async () => {
    setMeta(meta({ key: 'a.png', contentType: 'image/png', size: 100 }));
    http.expectOne('/api/admin/buckets/b1/objects/a.png?content').flush(new Blob(['a']));
    await Promise.resolve();
    const first = createSpy.mock.results[0].value as string;

    // Switch to object B — the effect must revoke A's URL first.
    setMeta(meta({ key: 'b.png', contentType: 'image/png', size: 100 }));
    expect(revokeSpy).toHaveBeenCalledWith(first);
    http.expectOne('/api/admin/buckets/b1/objects/b.png?content').flush(new Blob(['b']));
    await Promise.resolve();
  });

  it('over-cap image falls back without fetching bytes', () => {
    setMeta(meta({ key: 'huge.png', contentType: 'image/png', size: 30 * 1024 * 1024 }));
    http.expectNone('/api/admin/buckets/b1/objects/huge.png?content');
    expect(cmp.state()).toBe('fallback');
    expect(cmp.reason()).toBe('tooLarge');
  });

  it('fetches text with a bounded Range header and flags truncation on a 206', async () => {
    setMeta(meta({ key: 'big.log', contentType: 'text/plain', size: 5 * 1024 * 1024 }));
    const req = http.expectOne('/api/admin/buckets/b1/objects/big.log?content');
    expect(req.request.headers.get('Range')).toBe(`bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}`);
    expect(req.request.responseType).toBe('arraybuffer');

    const body = new TextEncoder().encode('hello world').buffer;
    req.flush(body, {
      status: 206,
      statusText: 'Partial Content',
      headers: { 'Content-Range': `bytes 0-${TEXT_PREVIEW_MAX_BYTES - 1}/9999999` },
    });
    await Promise.resolve();

    expect(cmp.state()).toBe('ready');
    expect(cmp.kind()).toBe('text');
    expect(cmp.text()).toBe('hello world');
    expect(cmp.truncated()).toBe(true);
  });

  it('shows the binary fallback for a blob mislabeled text/plain', async () => {
    setMeta(meta({ key: 'x.txt', contentType: 'text/plain', size: 100 }));
    const req = http.expectOne('/api/admin/buckets/b1/objects/x.txt?content');
    const bytes = new Uint8Array([0x48, 0x00, 0x49, 0x00]); // NUL bytes → binary
    req.flush(bytes.buffer, { status: 200, statusText: 'OK' });
    await Promise.resolve();

    expect(cmp.state()).toBe('fallback');
    expect(cmp.reason()).toBe('binary');
  });

  it('falls back (no fetch) for an unsupported type', () => {
    setMeta(meta({ key: 'a.zip', contentType: 'application/zip', size: 100 }));
    http.expectNone('/api/admin/buckets/b1/objects/a.zip?content');
    expect(cmp.state()).toBe('fallback');
    expect(cmp.reason()).toBe('unsupported');
  });
});

describe('text-preview.util (TEST-1100)', () => {
  it('looksBinary: NUL byte → binary', () => {
    expect(looksBinary(new Uint8Array([0x41, 0x00, 0x42]))).toBe(true);
  });

  it('looksBinary: plain ASCII text → not binary', () => {
    expect(looksBinary(new TextEncoder().encode('hello\nworld\t!'))).toBe(false);
  });

  it('looksBinary: UTF-8 high bytes are printable', () => {
    expect(looksBinary(new TextEncoder().encode('héllo — wörld'))).toBe(false);
  });

  it('looksBinary: >10% control bytes → binary', () => {
    const bytes = new Uint8Array(100);
    for (let i = 0; i < 100; i++) bytes[i] = i < 20 ? 0x01 : 0x41;
    expect(looksBinary(bytes)).toBe(true);
  });

  it('looksBinary: empty → not binary', () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });

  it('decodeUtf8 round-trips', () => {
    expect(decodeUtf8(new TextEncoder().encode('grüße'))).toBe('grüße');
  });
});
