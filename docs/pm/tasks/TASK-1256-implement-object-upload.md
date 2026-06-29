---
id: TASK-1256
title: Implement ObjectUploadComponent with single-encoding rule
story: STORY-0418
status: done
type: implementation
size: M
---

## Description
Drag-and-drop upload component. PUTs each file to `/api/admin/buckets/{bucket}/objects/{encodedKey}` where `encodedKey = encodeURIComponent(prefix + file.name)` (encoded exactly once — the backend `decodeURIComponent`s once).

## Files to create / modify
- `apps/frontend/src/app/objects/object-upload.component.ts` — new

## Implementation notes
- Verbatim from §5.14 (lines 8183–8267):
  ```ts
  @Component({
    standalone: true,
    selector: 'ob-object-upload',
    template: `
      <div class="dropzone" (dragover)="onDragOver($event)" (drop)="onDrop($event)">
        <input type="file" multiple (change)="onPick($event)" />
        <span>Drop files here, or click to select.</span>
      </div>
      @for (u of uploads(); track u.id) {
        <div class="row">
          <span>{{ u.name }}</span>
          <progress [value]="u.progress" max="100"></progress>
          @if (u.error) { <span class="error">{{ u.error }}</span> }
        </div>
      }
    `,
  })
  export class ObjectUploadComponent {
    private readonly http = inject(HttpClient);
    @Input({ required: true }) bucket!: string;
    @Input({ required: true }) prefix = '';
    @Output() uploaded = new EventEmitter<string>();
    readonly uploads = signal<UploadState[]>([]);

    private async startOne(file: File): Promise<void> {
      const id = crypto.randomUUID();
      const key = this.prefix + file.name;
      const encoded = encodeURIComponent(key);
      this.uploads.update((arr) => [...arr, { id, name: key, progress: 0 }]);
      const url = `/api/admin/buckets/${this.bucket}/objects/${encoded}`;
      // PUT with reportProgress + observe: 'events'
    }
  }
  ```
- §5.14 line 8269: "The encoded-once rule (`encodeURIComponent` on the client, `decodeURIComponent` once on the server) is the single rule that keeps slash-bearing keys from being treated as path segments."
- v1 uses the admin upload endpoint, not presigned URLs (line 8181).

## Acceptance criteria
- [ ] PUT URL is `/api/admin/buckets/{bucket}/objects/{encodeURIComponent(prefix + file.name)}`.
- [ ] Key is encoded **exactly once** (no double `encodeURIComponent`).
- [ ] Request uses `reportProgress: true` and `observe: 'events'`.
- [ ] `Content-Type` header is `file.type || 'application/octet-stream'`.
- [ ] Upload state is held in a signal array with `{ id, name, progress, error? }`.

## Test obligations
- Unit: covered by [TEST-0424]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1241], [TASK-1247]

## References
- `docs/WHITEPAPER.md` §5.14 (lines 8183–8269)
