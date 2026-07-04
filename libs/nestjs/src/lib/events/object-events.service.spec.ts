import { Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';

import { AppConfigService } from '../common/config/app-config.service';
import { ObjectEventsService } from './object-events.service';
import { OBJECT_EVENTS, type ObjectEvent } from './object-event.types';
import { OnObjectCreated } from './on-object-event.decorators';

const flush = () => new Promise((r) => setImmediate(r));

const CREATED: ObjectEvent = {
  type: OBJECT_EVENTS.created,
  bucket: 'b',
  key: 'k',
  size: 5,
  etag: 'abc',
  versionId: 'v1',
  eventTime: '2026-07-02T00:00:00.000Z',
};

/** Records the payload a decorated handler receives (case 1 — decorator wiring). */
@Injectable()
class CreatedRecorder {
  received: ObjectEvent[] = [];
  @OnObjectCreated()
  onCreated(event: ObjectEvent): void {
    this.received.push(event);
  }
}

describe('ObjectEventsService (TEST-0801, in-process)', () => {
  describe('emitInProcess', () => {
    it('case 1: a @OnObjectCreated() handler receives the exact payload', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot({ wildcard: false, delimiter: '.' })],
        providers: [ObjectEventsService, CreatedRecorder],
      }).compile();
      // Trigger onApplicationBootstrap so @nestjs/event-emitter binds the
      // @OnObjectCreated() handler on the emitter.
      await moduleRef.init();

      const svc = moduleRef.get(ObjectEventsService);
      const recorder = moduleRef.get(CreatedRecorder);

      svc.emitInProcess(CREATED);
      await flush();

      expect(recorder.received).toEqual([CREATED]);
      await moduleRef.close();
    });

    it('case 2: a throwing handler is caught+logged; emitInProcess returns synchronously', async () => {
      const emitter = new EventEmitter2();
      emitter.on(OBJECT_EVENTS.created, () => {
        throw new Error('handler-boom');
      });
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const svc = new ObjectEventsService(emitter);

      // Returns void synchronously and does NOT throw/reject.
      expect(svc.emitInProcess(CREATED)).toBeUndefined();
      await flush();

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('object-event handler failed for object.created b/k'),
        expect.anything(),
      );
      errSpy.mockRestore();
    });

    it('case 3: an async handler that rejects is isolated', async () => {
      const emitter = new EventEmitter2();
      emitter.on(OBJECT_EVENTS.created, async () => {
        throw new Error('async-boom');
      });
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const svc = new ObjectEventsService(emitter);

      svc.emitInProcess(CREATED);
      await flush();
      await flush();

      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe('enqueueInTx (outbox gate)', () => {
    const makeEm = () => {
      const created: unknown[] = [];
      const persisted: unknown[] = [];
      const em = {
        create: (_e: unknown, data: unknown) => {
          created.push(data);
          return data;
        },
        persist: (row: unknown) => {
          persisted.push(row);
        },
      };
      return { em, created, persisted };
    };

    const cfg = (over: Partial<Record<string, unknown>> = {}): AppConfigService =>
      ({
        webhooksEnabled: true,
        webhookEvents: ['object.created', 'object.deleted', 'multipart.completed'],
        ...over,
      }) as unknown as AppConfigService;

    it('case 8: enabled + event in filter → persists one row carrying JSON.stringify(event)', () => {
      const { em, created, persisted } = makeEm();
      const svc = new ObjectEventsService(new EventEmitter2(), cfg());

      svc.enqueueInTx(em as never, CREATED);

      expect(persisted).toHaveLength(1);
      expect((created[0] as { eventType: string }).eventType).toBe('object.created');
      expect((created[0] as { payload: string }).payload).toBe(JSON.stringify(CREATED));
      expect((created[0] as { status?: string }).status).toBeUndefined(); // entity default
    });

    it('case 9a: no config → no-op (pure-embedding users pay nothing)', () => {
      const { em, persisted } = makeEm();
      const svc = new ObjectEventsService(new EventEmitter2());
      svc.enqueueInTx(em as never, CREATED);
      expect(persisted).toHaveLength(0);
    });

    it('case 9b: webhooks disabled → no-op', () => {
      const { em, persisted } = makeEm();
      const svc = new ObjectEventsService(new EventEmitter2(), cfg({ webhooksEnabled: false }));
      svc.enqueueInTx(em as never, CREATED);
      expect(persisted).toHaveLength(0);
    });

    it('case 9c: event type filtered out → no-op', () => {
      const { em, persisted } = makeEm();
      const svc = new ObjectEventsService(
        new EventEmitter2(),
        cfg({ webhookEvents: ['object.deleted'] }),
      );
      svc.enqueueInTx(em as never, CREATED);
      expect(persisted).toHaveLength(0);
    });
  });
});
