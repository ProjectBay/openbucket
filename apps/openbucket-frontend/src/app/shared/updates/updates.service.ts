import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ReleaseInfo {
  version: string; // tag without the `nestjs-v` prefix
  name: string;
  date: string; // ISO
  notes: string; // markdown body
  url: string;
  prerelease: boolean;
}

const REPO = 'ProjectBay/openbucket';
export const GH_RELEASES = `https://github.com/${REPO}/releases`;
export const NPM_PAGE = 'https://www.npmjs.com/package/@openbucket/nestjs';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

/** Compare two semver-lite strings (`X.Y.Z` or `X.Y.Z-alpha.N`). >0 if a > b. */
export function cmpVersion(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-');
    const [maj = 0, min = 0, pat = 0] = core.split('.').map(Number);
    return { maj, min, pat, pre };
  };
  const A = parse(a);
  const B = parse(b);
  if (A.maj !== B.maj) return A.maj - B.maj;
  if (A.min !== B.min) return A.min - B.min;
  if (A.pat !== B.pat) return A.pat - B.pat;
  if (!A.pre && B.pre) return 1; // stable > prerelease
  if (A.pre && !B.pre) return -1;
  if (!A.pre && !B.pre) return 0;
  const as = A.pre.split('.');
  const bs = B.pre.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Shared version / update state. Fetches the running version from the admin API
 * and the release list from GitHub Releases (`nestjs-v*`), and derives whether a
 * newer version is available. Loaded once on first access (the sidebar footer),
 * reused by the About page. GitHub is fetched with the native `fetch` so the admin
 * JWT is never attached cross-origin; failures degrade to `checkFailed`.
 */
@Injectable({ providedIn: 'root' })
export class UpdatesService {
  private readonly http = inject(HttpClient);

  readonly current = signal<string | null>(null);
  readonly releases = signal<ReleaseInfo[]>([]);
  readonly loading = signal(false);
  readonly checkFailed = signal(false);

  readonly latest = computed(() => this.releases()[0]?.version ?? null);
  readonly latestUrl = computed(() => this.releases()[0]?.url ?? GH_RELEASES);
  readonly updateAvailable = computed(() => {
    const cur = this.current();
    const lat = this.latest();
    return !!cur && !!lat && cmpVersion(lat, cur) > 0;
  });

  private started = false;

  /** Kick off the first load exactly once (idempotent). */
  ensureLoaded(): void {
    if (this.started) return;
    this.started = true;
    void this.check();
  }

  async check(): Promise<void> {
    this.loading.set(true);
    this.checkFailed.set(false);
    await Promise.all([this.loadVersion(), this.loadReleases()]);
    this.loading.set(false);
  }

  private async loadVersion(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<{ version: string }>('/api/admin/version'));
      this.current.set(res.version);
    } catch {
      // endpoint may predate this console — leave current() null
    }
  }

  private async loadReleases(): Promise<void> {
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const data: Array<{
        tag_name: string;
        name: string | null;
        body: string | null;
        published_at: string;
        html_url: string;
        prerelease: boolean;
        draft: boolean;
      }> = await res.json();
      this.releases.set(
        data
          .filter((r) => !r.draft && r.tag_name?.startsWith('nestjs-v'))
          .map((r) => ({
            version: r.tag_name.replace(/^nestjs-v/, ''),
            name: r.name || r.tag_name,
            date: r.published_at,
            notes: (r.body || '').trim(),
            url: r.html_url,
            prerelease: r.prerelease,
          })),
      );
    } catch {
      this.checkFailed.set(true);
    }
  }
}
