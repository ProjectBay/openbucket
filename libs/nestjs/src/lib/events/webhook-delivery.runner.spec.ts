import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';

import type { AppConfigService } from '../common/config/app-config.service';
import type { Clock } from '../common/clock/clock';
import type { EventDeliveryRepository } from '../persistence/repositories/event-delivery.repository';
import type { EventDeliveryEntity } from '../persistence/entities/event-delivery.entity';
import { WebhookDeliveryRunner } from './webhook-delivery.runner';
import { WebhookSigner } from './webhook-signer';

const NOW = Date.parse('2026-07-02T12:00:00.000Z');
const SECRET = 'a-very-strong-webhook-secret-key-0123456789';
const URL = 'https://hooks.example.com/openbucket';

function makeRow(over: Partial<EventDeliveryEntity> = {}): EventDeliveryEntity {
  return {
    id: 'delivery-1',
    eventType: 'object.created',
    payload: JSON.stringify({ type: 'object.created', bucket: 'b', key: 'k' }),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(NOW - 1000),
    createdAt: new Date(NOW - 1000),
    deliveredAt: null,
    lastError: null,
    ...over,
  } as EventDeliveryEntity;
}

function makeConfig(over: Partial<Record<string, unknown>> = {}): AppConfigService {
  return {
    webhooksEnabled: true,
    webhookUrl: URL,
    webhookSecret: SECRET,
    webhookMaxAttempts: 3,
    webhookTimeoutMs: 5_000,
    webhookPollMs: 15_000,
    webhookEvents: ['object.created', 'object.deleted', 'multipart.completed'],
    ...over,
  } as unknown as AppConfigService;
}

function makeRepo(due: EventDeliveryEntity[]) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const pruneTerminal = jest.fn().mockResolvedValue(0);
  const repo = {
    findDue: jest.fn().mockResolvedValue(due),
    pruneTerminal,
    getEntityManager: () => ({ flush }),
  } as unknown as EventDeliveryRepository;
  return { repo, flush, pruneTerminal };
}

const clock: Clock = { nowMs: () => NOW, now: () => new Date(NOW) } as Clock;

describe('WebhookDeliveryRunner (TEST-0801)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // deterministic jitter
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const okResponse = (status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    body: { cancel: () => Promise.resolve() },
  });

  it('case: a 200 transitions the row to delivered with deliveredAt set, in one tick', async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    const row = makeRow();
    const { repo, flush, pruneTerminal } = makeRepo([row]);
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    expect(row.status).toBe('delivered');
    expect(row.deliveredAt).toEqual(new Date(NOW));
    expect(flush).toHaveBeenCalled();
    expect(pruneTerminal).toHaveBeenCalled();
  });

  it('case: the POST carries a valid signature + event/delivery headers', async () => {
    fetchMock.mockResolvedValue(okResponse(200));
    const row = makeRow();
    const { repo } = makeRepo([row]);
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBe(row.payload);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-OpenBucket-Event']).toBe('object.created');
    expect(headers['X-OpenBucket-Delivery']).toBe('delivery-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/^openbucket-webhooks\//);

    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers['X-OpenBucket-Signature']);
    expect(m).not.toBeNull();
    const expected = createHmac('sha256', SECRET).update(`${m![1]}.${row.payload}`).digest('hex');
    expect(m![2]).toBe(expected);
  });

  it('case: a 500 keeps the row pending, bumps attempts, pushes nextAttemptAt forward', async () => {
    fetchMock.mockResolvedValue(okResponse(500));
    const row = makeRow();
    const { repo } = makeRepo([row]);
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('HTTP 500');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(NOW);
  });

  it('case: after maxAttempts a failing row is dead-lettered to failed with truncated lastError', async () => {
    fetchMock.mockResolvedValue(okResponse(503));
    const row = makeRow({ attempts: 2 }); // maxAttempts = 3 → this bump reaches it
    const { repo } = makeRepo([row]);
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    expect(row.attempts).toBe(3);
    expect(row.status).toBe('failed');
    expect((row.lastError ?? '').length).toBeLessThanOrEqual(512);
  });

  it('case: a timeout (AbortError) records lastError=timeout and keeps the row pending', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const row = makeRow();
    const { repo } = makeRepo([row]);
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    expect(row.status).toBe('pending');
    expect(row.lastError).toBe('timeout');
  });

  it('case: a 3xx is treated as a failure (redirects are not followed)', async () => {
    fetchMock.mockResolvedValue(okResponse(301));
    const row = makeRow();
    const { repo } = makeRepo([row]);
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
  });

  it('case: the secret never appears in any log output', async () => {
    fetchMock.mockResolvedValue(okResponse(500));
    const row = makeRow({ attempts: 2 }); // will dead-letter → warn logged
    const { repo } = makeRepo([row]);
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((...a) => logged.push(a.join(' ')));
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...a) => logged.push(a.join(' ')));
    jest.spyOn(Logger.prototype, 'debug').mockImplementation((...a) => logged.push(a.join(' ')));
    const runner = new WebhookDeliveryRunner(repo, makeConfig(), new WebhookSigner(), clock);

    await runner.run();

    expect(logged.join('\n')).not.toContain(SECRET);
  });

  it('case: webhooks disabled → no fetch, no due-scan', async () => {
    const { repo } = makeRepo([]);
    const findDue = repo.findDue as jest.Mock;
    const runner = new WebhookDeliveryRunner(
      repo,
      makeConfig({ webhooksEnabled: false }),
      new WebhookSigner(),
      clock,
    );

    await runner.run();

    expect(findDue).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('case: intervalMs is sourced from config.webhookPollMs', () => {
    const { repo } = makeRepo([]);
    const runner = new WebhookDeliveryRunner(
      repo,
      makeConfig({ webhookPollMs: 30_000 }),
      new WebhookSigner(),
      clock,
    );
    expect(runner.intervalMs).toBe(30_000);
    expect(runner.name).toBe('webhook-delivery');
  });
});
