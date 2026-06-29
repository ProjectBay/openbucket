import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

interface LoginResponse {
  accessToken: string;
  expiresIn: number;
}

interface MeResponse {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

/**
 * Admin auth state (§5.12). The access token lives ONLY in an in-memory signal —
 * never localStorage/sessionStorage. On reload the SPA calls refresh() (the
 * HttpOnly cookie carries the refresh token) to mint a fresh access token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly me = signal<MeResponse | null>(null);

  readonly isAuthenticated = computed(() => this.accessToken() !== null);
  readonly mustChangePassword = computed(() => this.me()?.mustChangePassword === true);
  readonly username = computed(() => this.me()?.username ?? null);

  getAccessToken(): string | null {
    return this.accessToken();
  }

  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(
        '/api/admin/auth/login',
        { username, password },
        { withCredentials: true },
      ),
    );
    this.accessToken.set(res.accessToken);
    await this.loadMe();
    await this.router.navigate([this.mustChangePassword() ? '/force-rotate' : '/buckets']);
  }

  /** After a forced password rotation: refresh /me (clears mustChangePassword) and continue. */
  async finishRotation(): Promise<void> {
    await this.loadMe();
    await this.router.navigate(['/buckets']);
  }

  /**
   * Calls the refresh endpoint exactly once — used at app start and by the HTTP
   * interceptor on 401. Returns true on success; on failure both signals clear.
   */
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
      await firstValueFrom(
        this.http.post('/api/admin/auth/logout', {}, { withCredentials: true }),
      );
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
