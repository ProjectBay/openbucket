import { createHmac } from 'node:crypto';

import { WebhookSigner } from './webhook-signer';

describe('WebhookSigner (TEST-0801)', () => {
  const signer = new WebhookSigner();
  const secret = 'a-very-strong-webhook-secret-key-0123456789';

  it('case: header is t=<unix>,v1=<hmac> over "<t>.<rawBody>", verifiable by recompute', () => {
    const rawBody = JSON.stringify({ type: 'object.created', bucket: 'b', key: 'k' });
    const now = 1_760_000_000_000; // fixed ms
    const { header, timestamp } = signer.sign(rawBody, secret, now);

    const t = Math.floor(now / 1000);
    expect(timestamp).toBe(t);

    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(t);

    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    expect(m![2]).toBe(expected);
  });

  it('case: signature covers the timestamp (a different second yields a different mac)', () => {
    const rawBody = 'payload';
    const a = signer.sign(rawBody, secret, 1_000_000);
    const b = signer.sign(rawBody, secret, 2_000_000);
    expect(a.header).not.toBe(b.header);
  });

  it('case: a different secret yields a different mac', () => {
    const rawBody = 'payload';
    const now = 1_000_000;
    const a = signer.sign(rawBody, secret, now);
    const b = signer.sign(rawBody, 'another-very-strong-secret-key-abcdefghij', now);
    expect(a.header).not.toBe(b.header);
  });
});
