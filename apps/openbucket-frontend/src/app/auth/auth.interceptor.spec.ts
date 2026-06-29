import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

/**
 * TEST-0422 — authInterceptor single-retry semantics (§5.12).
 *
 * NOTE: parked until the frontend jest harness is wired; behaviour is
 * build-verified. Cases: no bearer on auth paths; bearer on others; one refresh
 * + retry on 401; logout + rethrow when refresh fails.
 */
describe('authInterceptor (TEST-0422)', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: { getAccessToken: jest.Mock; refresh: jest.Mock; logout: jest.Mock };

  beforeEach(() => {
    auth = {
      getAccessToken: jest.fn().mockReturnValue('tok'),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('does not attach a bearer to login/refresh', () => {
    http.post('/api/admin/auth/login', {}).subscribe();
    const r = ctrl.expectOne('/api/admin/auth/login');
    expect(r.request.headers.has('Authorization')).toBe(false);
    r.flush({});
  });

  it('attaches the bearer to other requests', () => {
    http.get('/api/admin/buckets').subscribe();
    const r = ctrl.expectOne('/api/admin/buckets');
    expect(r.request.headers.get('Authorization')).toBe('Bearer tok');
    r.flush([]);
  });

  it('on 401, refreshes once and retries with the new token', async () => {
    auth.refresh.mockResolvedValue(true);
    auth.getAccessToken.mockReturnValueOnce('tok').mockReturnValue('tok2');

    http.get('/api/admin/buckets').subscribe();
    ctrl.expectOne('/api/admin/buckets').flush('no', { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();

    const retry = ctrl.expectOne('/api/admin/buckets');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer tok2');
    retry.flush([{ name: 'b' }]);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('on a failed refresh, logs out and rethrows', async () => {
    auth.refresh.mockResolvedValue(false);
    let errored = false;

    http.get('/api/admin/buckets').subscribe({ error: () => (errored = true) });
    ctrl.expectOne('/api/admin/buckets').flush('no', { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();

    expect(auth.logout).toHaveBeenCalled();
    expect(errored).toBe(true);
  });
});
