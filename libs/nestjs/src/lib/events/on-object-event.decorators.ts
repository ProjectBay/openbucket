import { OnEvent } from '@nestjs/event-emitter';

import { OBJECT_EVENTS } from './object-event.types';

/**
 * Ergonomic, typed wrappers over `@OnEvent(...)` so host code registers
 * in-process handlers without coupling to the raw event-name strings. Apply to a
 * provider method; the annotated method receives `(event: ObjectEvent)`.
 *
 * These handlers run **in the host process with host-process privileges** —
 * OpenBucket does NOT sandbox them (the host owns them, unlike a remote webhook
 * receiver). They are dispatched fire-and-forget (`emitAsync`, not awaited), so a
 * handler that throws or hangs cannot stall or fail the PUT/DELETE data plane.
 */

/** Fires after a committed `PutObject` / `CopyObject` / admin `putFromStream`. */
export const OnObjectCreated = (): MethodDecorator => OnEvent(OBJECT_EVENTS.created);

/** Fires after a committed `DeleteObject` / bulk / admin delete (or delete-marker). */
export const OnObjectDeleted = (): MethodDecorator => OnEvent(OBJECT_EVENTS.deleted);

/** Fires after a committed `CompleteMultipartUpload`. */
export const OnMultipartCompleted = (): MethodDecorator =>
  OnEvent(OBJECT_EVENTS.multipartCompleted);
