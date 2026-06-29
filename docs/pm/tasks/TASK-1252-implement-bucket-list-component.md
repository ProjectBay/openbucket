---
id: TASK-1252
title: Implement BucketListComponent consuming BucketsService
story: STORY-0417
status: done
type: implementation
size: S
---

## Description
Replace the placeholder `BucketListComponent` with the implementation from §5.13: a standalone component that injects `BucketsService` from `@openbucket/api-client`, holds `buckets` and `loading` signals, and renders the list.

## Files to create / modify
- `apps/frontend/src/app/buckets/bucket-list.component.ts` — modify
- `apps/frontend/src/app/shared/ui/byte-size.pipe.ts` — new (standalone pipe for `| byteSize`)
- `apps/frontend/src/app/shared/ui/relative-time.pipe.ts` — new (standalone pipe for `| relativeTime`)

## Implementation notes
- Verbatim from §5.13 (lines 8100–8156):
  ```ts
  @Component({
    standalone: true,
    selector: 'ob-bucket-list',
    imports: [CommonModule, RouterLink, ByteSizePipe, RelativeTimePipe],
    template: `
      <div class="toolbar">
        <h1>Buckets</h1>
        <button (click)="openCreate()">Create bucket</button>
      </div>
      @if (loading()) { <p>Loading…</p> }
      @else {
        <table>...</table>
      }
    `,
  })
  export class BucketListComponent implements OnInit {
    private readonly api = inject(BucketsService);
    readonly buckets = signal<BucketSummaryDto[]>([]);
    readonly loading = signal(true);

    async ngOnInit(): Promise<void> {
      try {
        const res = await this.api.bucketsAdminControllerList().toPromise();
        this.buckets.set(res?.buckets ?? []);
      } finally {
        this.loading.set(false);
      }
    }
    openCreate(): void { /* opens BucketCreateDialogComponent */ }
  }
  ```
- After [TASK-1251] adds `operationId: 'listBuckets'`, call `this.api.listBuckets()` instead of `bucketsAdminControllerList()`.
- `STORY-0419` will refactor this to use `BucketsSignalStore`.

## Acceptance criteria
- [ ] Component is standalone with the imports listed above.
- [ ] Calls `BucketsService.listBuckets()` in `ngOnInit`.
- [ ] Renders a row per bucket via `RouterLink` to `['/buckets', b.name, 'browse']`.
- [ ] `ByteSizePipe` and `RelativeTimePipe` are standalone pipes.

## Test obligations
- Unit: covered by [TEST-0423]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1250], [TASK-1251]

## References
- `docs/WHITEPAPER.md` §5.13 (lines 8100–8160)
