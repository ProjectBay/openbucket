import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { mountPrefixInterceptor, resolveMountPrefix } from './mount-prefix';

/**
 * The admin console is served under `<mountPath>/admin`; the backend rewrites the
 * `<base href>` to `<mountPath>/admin/`. All API URLs the SPA builds are otherwise
 * root-absolute (`/api/admin/...`), so they 404 under any non-root mount. The
 * interceptor prefixes them with the derived mount.
 *
 * NOTE: parked until the frontend jest harness is wired (see auth.interceptor.spec);
 * the derivation + build are otherwise verified.
 */
describe('resolveMountPrefix', () => {
  const doc = (href: string | null): Document =>
    ({ querySelector: () => (href === null ? null : { getAttribute: () => href }) }) as never;

  it('derives the mount prefix from <base href>', () => {
    expect(resolveMountPrefix(doc('/storage/admin/'))).toBe('/storage');
    expect(resolveMountPrefix(doc('/deep/mount/admin/'))).toBe('/deep/mount');
  });

  it('is empty for the standalone root (/admin/) and when no base is present', () => {
    expect(resolveMountPrefix(doc('/admin/'))).toBe('');
    expect(resolveMountPrefix(doc(null))).toBe('');
  });
});

describe('mountPrefixInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  const withBaseHref = (href: string) => {
    document.head.querySelectorAll('base').forEach((b) => b.remove());
    const base = document.createElement('base');
    base.setAttribute('href', href);
    document.head.appendChild(base);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([mountPrefixInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    ctrl.verify();
    document.head.querySelectorAll('base').forEach((b) => b.remove());
  });

  it('prefixes /api/* calls with the mount when mounted', () => {
    withBaseHref('/storage/admin/');
    http.post('/api/admin/auth/login', {}).subscribe();
    ctrl.expectOne('/storage/api/admin/auth/login').flush({});
  });

  it('leaves /api/* calls untouched for the standalone root', () => {
    withBaseHref('/admin/');
    http.get('/api/admin/buckets').subscribe();
    ctrl.expectOne('/api/admin/buckets').flush({});
  });

  it('never rewrites non-/api URLs', () => {
    withBaseHref('/storage/admin/');
    http.get('/my-bucket/photo.jpg').subscribe();
    ctrl.expectOne('/my-bucket/photo.jpg').flush({});
  });
});
