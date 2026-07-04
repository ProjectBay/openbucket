---
id: TASK-2410
title: Define the object-event contract, ObjectEventsService, and handler decorators
story: STORY-0801
status: backlog
type: implementation
size: M
---

## Description
Establish the in-process event core: the typed `ObjectEvent` payload, a global `EventsModule` that wires `@nestjs/event-emitter`, an injectable `ObjectEventsService` façade with `emit()` / `emitInProcess()` seams, and the three ergonomic handler decorators (`@OnObjectCreated`, `@OnObjectDeleted`, `@OnMultipartCompleted`) a host app applies to provider methods. This is the embedding advantage and the foundation the emit sites ([TASK-2411]) and the webhook outbox ([TASK-2412]/[TASK-2413]) build on. No emit sites are wired here — this task only produces the contract, the module, and the public exports.

## Files to create / modify
- `libs/nestjs/src/lib/events/object-event.types.ts` — new (payload interface + event-name constants).
- `libs/nestjs/src/lib/events/object-events.service.ts` — new (`ObjectEventsService`).
- `libs/nestjs/src/lib/events/on-object-event.decorators.ts` — new (the three `@On…` decorators).
- `libs/nestjs/src/lib/events/events.module.ts` — new (`@Global`, imports `EventEmitterModule.forRoot()`, provides+exports `ObjectEventsService`).
- `libs/nestjs/src/lib/open-bucket-core.module.ts` — modify `buildCoreImports()` (around line 47): add `EventsModule` early, after `ConfigModule`/logger and before `StorageModule`/`DomainModule`, so those can inject `ObjectEventsService`.
- `libs/nestjs/src/index.ts` (library barrel) — modify: re-export `ObjectEvent`, `ObjectEventType`, the three decorators, and `ObjectEventsService` for host apps.
- `package.json` — modify: add `@nestjs/event-emitter` (^3) to `dependencies`.

## Implementation notes
- Payload shape is fixed by the Story; keep it flat and JSON-serializable (the webhook body is `JSON.stringify(event)`):
  ```ts
  export const OBJECT_EVENTS = {
    created: 'object.created',
    deleted: 'object.deleted',
    multipartCompleted: 'multipart.completed',
  } as const;
  export type ObjectEventType = (typeof OBJECT_EVENTS)[keyof typeof OBJECT_EVENTS];
  export interface ObjectEvent {
    type: ObjectEventType;
    bucket: string;
    key: string;
    size: number;        // bytes; 0 for a delete / delete-marker
    etag: string;        // '' for a delete-marker
    versionId?: string;  // present only on versioning-enabled buckets
    eventTime: string;   // ISO-8601 (Date.toISOString())
  }
  ```
- `EventsModule` is `@Global` and calls `EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', verboseMemoryLeak: false })` exactly once (a second `forRoot` app-wide is a footgun — mirror the single-`forRoot` discipline the `ThrottlerModule` comment in `admin/admin.module.ts` calls out). Being global lets `StorageModule` (the writer) and `DomainModule` (`ObjectService`) inject `ObjectEventsService` without an explicit import cycle.
- `ObjectEventsService` wraps `EventEmitter2`:
  ```ts
  @Injectable()
  export class ObjectEventsService {
    private readonly log = new Logger(ObjectEventsService.name);
    constructor(private readonly emitter: EventEmitter2) {}
    /** Fire-and-forget in-process dispatch. Handler errors are isolated. */
    emitInProcess(event: ObjectEvent): void {
      // emitAsync so async handlers are awaited by the emitter, but we do NOT
      // await here — the write path must never block or fail on a handler.
      this.emitter.emitAsync(event.type, event).catch((err) =>
        this.log.error(`object-event handler failed for ${event.type} ${event.bucket}/${event.key}`, err as Error),
      );
    }
  }
  ```
  Webhook enqueue (`enqueueInTx`) is added in [TASK-2412]; keep this task's service surface to the in-process seam so it has no persistence dependency yet.
- Decorators are thin, typed wrappers over `@OnEvent` so host code reads well and stays decoupled from the string names:
  ```ts
  export const OnObjectCreated = (): MethodDecorator => OnEvent(OBJECT_EVENTS.created);
  export const OnObjectDeleted = (): MethodDecorator => OnEvent(OBJECT_EVENTS.deleted);
  export const OnMultipartCompleted = (): MethodDecorator => OnEvent(OBJECT_EVENTS.multipartCompleted);
  ```
  Document that the annotated method receives `(event: ObjectEvent)`.
- Edge cases / security: in-process handlers run with **host-process privileges** — document in the JSDoc that OpenBucket does not sandbox them (the host owns them, unlike a webhook receiver). `emitAsync` is not awaited, so a handler that hangs cannot stall a PUT (no DoS on the data plane). No user-controlled string is used as an event name (only the three constants), so the wildcard/namespace surface of `EventEmitter2` is not reachable from object keys.

## Acceptance criteria
- [ ] `ObjectEvent`, `ObjectEventType`, `ObjectEventsService`, and the three decorators are exported from the library barrel and appear in the `nx build nestjs` `.d.ts` output.
- [ ] A unit spec registers a provider with `@OnObjectCreated()` and asserts it receives the exact payload when `ObjectEventsService.emitInProcess` fires.
- [ ] A handler that throws is caught and logged; the spec asserts `emitInProcess` returns synchronously and does not reject.
- [ ] `EventEmitterModule.forRoot()` is invoked exactly once (grep asserts a single call site).
- [ ] `nx test nestjs --testPathPattern=events` passes.

## Test obligations
- Unit: covered by [TEST-0801] (cases 1–3).
- E2E: N/A (no HTTP surface in this task).
- Conformance: N/A.

## Dependencies
- Blocked by: _none_ (foundation task; land first within the Story).

## References
- `libs/nestjs/src/lib/admin/audit/audit.service.ts` (structured-event façade to mirror in spirit).
- `libs/nestjs/src/lib/admin/admin.module.ts:40` (single-`forRoot` discipline note).
- `libs/nestjs/src/lib/open-bucket-core.module.ts:47` (`buildCoreImports` ordering).
- `@nestjs/event-emitter` docs (`EventEmitter2`, `@OnEvent`, `emitAsync`).
</content>
