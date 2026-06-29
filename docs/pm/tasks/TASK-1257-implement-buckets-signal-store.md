---
id: TASK-1257
title: Implement BucketsSignalStore
story: STORY-0419
status: done
type: implementation
size: S
---

## Description
Tiny signal store: `_items`, `_loading`, `_error` private signals; public `items`, `loading`, `error`, `count` read accessors; `refresh`, `create`, `remove` methods that call `BucketsService` and update the signals on success.

## Files to create / modify
- `apps/frontend/src/app/buckets/buckets.signal-store.ts` — new

## Implementation notes
- Verbatim from §5.15 (lines 8278–8318):
  ```ts
  @Injectable({ providedIn: 'root' })
  export class BucketsSignalStore {
    private readonly api = inject(BucketsService);

    private readonly _items = signal<BucketSummaryDto[]>([]);
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
        const res = await firstValueFrom(this.api.listBuckets());
        this._items.set(res?.buckets ?? []);
      } catch (e) {
        this._error.set((e as Error).message);
      } finally {
        this._loading.set(false);
      }
    }

    async create(dto: CreateBucketDto): Promise<void> {
      const created = await firstValueFrom(this.api.createBucket(dto));
      if (created) this._items.update((arr) => [...arr, created]);
    }

    async remove(name: string): Promise<void> {
      await firstValueFrom(this.api.deleteBucket(name));
      this._items.update((arr) => arr.filter((b) => b.name !== name));
    }
  }
  ```
- §5.15 closing note: NgRx SignalStore can replace this later without changing the read surface.

## Acceptance criteria
- [ ] Private signals are not directly exposed; only `asReadonly()` views are.
- [ ] `count` is a `computed` signal of items length.
- [ ] `create` appends only when the API returns a record.
- [ ] `remove` filters `_items` by name after the API call resolves.

## Test obligations
- Unit: covered by [TEST-0425]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1250]

## References
- `docs/WHITEPAPER.md` §5.15 (lines 8273–8321)
