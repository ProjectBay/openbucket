import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * TEST-0421 — AuthService (§5.12).
 *
 * NOTE: parked until the frontend jest harness is wired (no test target yet);
 * the behaviour is build-verified. Cases: login sets the token + navigates by
 * mustChangePassword; refresh success/failure; logout clears + routes to /login;
 * the token never touches storage.
 */
describe('AuthService (TEST-0421)', () => {
  let svc: AuthService;
  let http: HttpTestingController;
  let navigate: jest.Mock;

  beforeEach(() => {
    navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
      ],
    });
    svc = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('login: posts credentials, stores the token, loads me, navigates to /buckets', async () => {
    const p = svc.login('admin', 'pw');
    http.expectOne('/api/admin/auth/login').flush({ accessToken: 'tok', expiresIn: 900 });
    http.expectOne('/api/admin/auth/me').flush({ id: 'admin', username: 'admin', mustChangePassword: false });
    await p;

    expect(svc.isAuthenticated()).toBe(true);
    expect(svc.getAccessToken()).toBe('tok');
    expect(navigate).toHaveBeenCalledWith(['/buckets']);
  });

  it('login: navigates to /force-rotate when mustChangePassword', async () => {
    const p = svc.login('admin', 'pw');
    http.expectOne('/api/admin/auth/login').flush({ accessToken: 'tok', expiresIn: 900 });
    http.expectOne('/api/admin/auth/me').flush({ id: 'admin', username: 'admin', mustChangePassword: true });
    await p;
    expect(navigate).toHaveBeenCalledWith(['/force-rotate']);
  });

  it('refresh: success sets the token and returns true', async () => {
    const p = svc.refresh();
    http.expectOne('/api/admin/auth/refresh').flush({ accessToken: 'tok2', expiresIn: 900 });
    http.expectOne('/api/admin/auth/me').flush({ id: 'admin', username: 'admin', mustChangePassword: false });
    expect(await p).toBe(true);
    expect(svc.getAccessToken()).toBe('tok2');
  });

  it('refresh: failure clears both signals and returns false', async () => {
    const p = svc.refresh();
    http.expectOne('/api/admin/auth/refresh').flush('no', { status: 401, statusText: 'Unauthorized' });
    expect(await p).toBe(false);
    expect(svc.isAuthenticated()).toBe(false);
  });

  it('logout: clears state and routes to /login', async () => {
    const p = svc.logout();
    http.expectOne('/api/admin/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await p;
    expect(svc.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('never writes the token to web storage', async () => {
    const p = svc.login('admin', 'pw');
    http.expectOne('/api/admin/auth/login').flush({ accessToken: 'secret-tok', expiresIn: 900 });
    http.expectOne('/api/admin/auth/me').flush({ id: 'admin', username: 'admin', mustChangePassword: false });
    await p;
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(JSON.stringify(sessionStorage)).not.toContain('secret-tok');
  });
});
