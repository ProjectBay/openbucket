import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CreateKeyDto,
  CreatedKeyDto,
  KeySummaryDto,
  KeysAdminService,
  UpdateKeyDto,
} from '@openbucket/api-client';

/**
 * Access-keys read/write store (STORY-0611), mirroring BucketsSignalStore over
 * KeysAdminService. The created secret is returned from `create` (shown once);
 * the store keeps only the summary view.
 */
@Injectable({ providedIn: 'root' })
export class KeysSignalStore {
  private readonly api = inject(KeysAdminService);

  private readonly _items = signal<KeySummaryDto[]>([]);
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
      const res = await firstValueFrom(this.api.listKeys());
      this._items.set(res ?? []);
    } catch (e) {
      this._error.set((e as Error).message);
    } finally {
      this._loading.set(false);
    }
  }

  async create(dto: CreateKeyDto): Promise<CreatedKeyDto> {
    const created = await firstValueFrom(this.api.createKey(dto));
    this._items.update((arr) => [
      ...arr,
      {
        id: created.id,
        accessKeyId: created.accessKeyId,
        label: created.label,
        role: created.role,
        createdAt: created.createdAt,
        lastUsedAt: null,
        disabled: false,
      },
    ]);
    return created;
  }

  async update(id: string, dto: UpdateKeyDto): Promise<void> {
    const updated = await firstValueFrom(this.api.updateKey(id, dto));
    if (updated) this._items.update((arr) => arr.map((k) => (k.id === id ? updated : k)));
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.api.deleteKey(id));
    this._items.update((arr) => arr.filter((k) => k.id !== id));
  }
}
