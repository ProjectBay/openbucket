---
id: TASK-1247
title: Implement SPA AuthService with signal-backed access token
story: STORY-0416
status: done
type: implementation
size: M
---

## Description
The SPA-side `AuthService`. Holds access token + me in private signals; exposes computed `isAuthenticated`, `mustChangePassword`, `username`. Public methods `login`, `refresh`, `logout`, `loadMe`. Never persists to `localStorage`.

## Files to create / modify
- `apps/frontend/src/app/auth/auth.service.ts` — new

## Implementation notes
- Verbatim from §5.12 (lines 7950–8014):
  ```ts
  @Injectable({ providedIn: 'root' })
  export class AuthService {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    private readonly accessToken = signal<string | null>(null);
    private readonly me = signal<MeResponse | null>(null);

    readonly isAuthenticated = computed(() => this.accessToken() !== null);
    readonly mustChangePassword = computed(() => this.me()?.mustChangePassword === true);
    readonly username = computed(() => this.me()?.username ?? null);

    getAccessToken(): string | null { return this.accessToken(); }

    async login(username: string, password: string): Promise<void> {
      const res = await firstValueFrom(
        this.http.post<LoginResponse>('/api/admin/auth/login', { username, password }, { withCredentials: true }),
      );
      this.accessToken.set(res.accessToken);
      await this.loadMe();
      await this.router.navigate([this.mustChangePassword() ? '/force-rotate' : '/buckets']);
    }

    async refresh(): Promise<boolean> {
      try {
        const res = await firstValueFrom(
          this.http.post<LoginResponse>('/api/admin/auth/refresh', {}, { withCredentials: true }),
        );
        this.accessToken.set(res.accessToken);
        if (!this.me()) await this.loadMe();
        return true;
      } catch {
        this.accessToken.set(null);
        this.me.set(null);
        return false;
      }
    }

    async logout(): Promise<void> {
      try {
        await firstValueFrom(this.http.post('/api/admin/auth/logout', {}, { withCredentials: true }));
      } finally {
        this.accessToken.set(null);
        this.me.set(null);
        await this.router.navigate(['/login']);
      }
    }

    private async loadMe(): Promise<void> {
      const me = await firstValueFrom(this.http.get<MeResponse>('/api/admin/auth/me'));
      this.me.set(me);
    }
  }
  ```
- Local types `LoginResponse = { accessToken: string; expiresIn: number }` and `MeResponse = { id: string; username: string; mustChangePassword: boolean }`.

## Acceptance criteria
- [ ] `accessToken` and `me` are private signals; only computed read accessors are exported.
- [ ] All requests carry `withCredentials: true`.
- [ ] `login` navigates to `/force-rotate` when `mustChangePassword`, else `/buckets`.
- [ ] `refresh` returns `false` and clears signals on error.
- [ ] No use of `localStorage` or `sessionStorage` anywhere in the file.

## Test obligations
- Unit: covered by [TEST-0421]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1242]

## References
- `docs/WHITEPAPER.md` §5.12 (lines 7928–8014)
