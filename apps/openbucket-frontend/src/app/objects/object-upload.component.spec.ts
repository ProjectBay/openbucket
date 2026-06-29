import { HttpEventType } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ObjectUploadComponent } from './object-upload.component';

/**
 * TEST-0424 — ObjectUploadComponent (§5.14).
 *
 * NOTE: parked until the frontend jest harness is wired; the component is
 * build-verified. Covers single-encode key construction, progress tracking,
 * the `uploaded` emit on completion, and error capture.
 */
describe('ObjectUploadComponent (TEST-0424)', () => {
  let fixture: ComponentFixture<ObjectUploadComponent>;
  let cmp: ObjectUploadComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ObjectUploadComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ObjectUploadComponent);
    cmp = fixture.componentInstance;
    cmp.bucket = 'photos';
    cmp.prefix = 'a/b/';
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const file = (name: string) =>
    new File(['hello'], name, { type: 'text/plain' });

  it('PUTs to the once-encoded key under the current prefix', () => {
    cmp.onDrop({
      preventDefault: () => undefined,
      dataTransfer: { files: [file('c d.txt')] as unknown as FileList },
    } as unknown as DragEvent);

    // key = 'a/b/c d.txt' → encodeURIComponent once
    const url = '/api/admin/buckets/photos/objects/a%2Fb%2Fc%20d.txt';
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('Content-Type')).toBe('text/plain');
    req.flush(null);
  });

  it('tracks progress and emits the decoded key on completion', async () => {
    const emitted: string[] = [];
    cmp.uploaded.subscribe((k) => emitted.push(k));

    cmp.onPick({ target: { files: [file('x.bin')] } } as unknown as Event);

    const req = http.expectOne('/api/admin/buckets/photos/objects/a%2Fb%2Fx.bin');
    req.event({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    expect(cmp.uploads()[0].progress).toBe(50);

    req.flush(null);
    await Promise.resolve();
    expect(cmp.uploads()[0].progress).toBe(100);
    expect(emitted).toEqual(['a/b/x.bin']);
  });

  it('captures an upload error', async () => {
    cmp.onPick({ target: { files: [file('y.bin')] } } as unknown as Event);
    const req = http.expectOne('/api/admin/buckets/photos/objects/a%2Fb%2Fy.bin');
    req.flush('nope', { status: 500, statusText: 'Server Error' });
    await Promise.resolve();
    expect(cmp.uploads()[0].status).toBe('error');
  });
});
