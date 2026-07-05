import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AdminUserSummaryDto,
  AdminUsersService,
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from '@openbucket/api-client';

/**
 * Multi-admin users read/write store (EPIC-11, STORY-1002), mirroring
 * KeysSignalStore over the regenerated AdminUsersService. Keeps the secret-free
 * summary list; create/update/remove re-fetch or patch the local list. The
 * server-side RolesGuard remains authoritative for authorization.
 */
@Injectable({ providedIn: 'root' })
export class AdminUsersSignalStore {
  private readonly api = inject(AdminUsersService);

  private readonly _items = signal<AdminUserSummaryDto[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly count = computed(() => this._items().length);

  async refresh(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const res = await firstValueFrom(this.api.listAdminUsers());
      this._items.set(res ?? []);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async create(dto: CreateAdminUserDto): Promise<AdminUserSummaryDto> {
    const created = await firstValueFrom(this.api.createAdminUser(dto));
    this._items.update((arr) => [...arr, created]);
    return created;
  }

  async update(username: string, dto: UpdateAdminUserDto): Promise<void> {
    await firstValueFrom(this.api.updateAdminUser(username, dto));
    // The PATCH returns 204 (no body), so patch the known fields locally. The
    // update + summary role enums share values but are distinct generated types.
    const role = dto.role as unknown as AdminUserSummaryDto['role'] | undefined;
    this._items.update((arr) =>
      arr.map((u) => (u.username === username && role ? { ...u, role } : u)),
    );
  }

  async remove(username: string): Promise<void> {
    await firstValueFrom(this.api.deleteAdminUser(username));
    this._items.update((arr) => arr.filter((u) => u.username !== username));
  }
}
