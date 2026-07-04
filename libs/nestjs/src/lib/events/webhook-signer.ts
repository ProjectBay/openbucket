import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

/** The signature/headers a signed webhook POST carries. */
export interface WebhookSignature {
  /** `t=<unix>,v1=<hex-hmac>` — the `X-OpenBucket-Signature` value. */
  header: string;
  /** The unix-second timestamp bound into the signature. */
  timestamp: number;
}

/**
 * Pure HMAC-SHA256 webhook signing (Stripe-style, STORY-0801). The signature
 * covers `"<timestamp>.<rawBody>"` so a receiver can reject stale timestamps
 * (replay defence) and MUST verify with a constant-time compare. The secret is
 * never logged and never leaves this signer.
 */
@Injectable()
export class WebhookSigner {
  sign(rawBody: string, secret: string, now: number = Date.now()): WebhookSignature {
    const t = Math.floor(now / 1000);
    const mac = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return { header: `t=${t},v1=${mac}`, timestamp: t };
  }
}
