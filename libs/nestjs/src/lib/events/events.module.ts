import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { ObjectEventsService } from './object-events.service';
import { WebhookSigner } from './webhook-signer';

/**
 * The in-process event core (STORY-0801). `@Global` so the storage layer (the
 * writer) and the domain layer (`ObjectService`) can inject `ObjectEventsService`
 * without an explicit import cycle, and so the background `WebhookDeliveryRunner`
 * resolves `WebhookSigner`.
 *
 * `EventEmitterModule.forRoot()` MUST be called exactly ONCE app-wide (the module
 * is `@Global`, so a second `forRoot` elsewhere is a footgun that re-registers
 * the emitter — same single-`forRoot` discipline the `ThrottlerModule` note in
 * `admin/admin.module.ts` calls out). `wildcard: false` keeps event names as
 * literal strings (no namespace matching), so only the three fixed
 * `OBJECT_EVENTS` names are dispatchable.
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', verboseMemoryLeak: false }),
  ],
  providers: [ObjectEventsService, WebhookSigner],
  exports: [ObjectEventsService, WebhookSigner],
})
export class EventsModule {}
