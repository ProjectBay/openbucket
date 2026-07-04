import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../common/config/app-config.service';
import { Clock } from '../common/clock/clock';
import { ScheduledTask } from '../common/background/background.service';
import { EventDeliveryRepository } from '../persistence/repositories/event-delivery.repository';
import type { EventDeliveryEntity } from '../persistence/entities/event-delivery.entity';
import { OPENBUCKET_VERSION } from '../version';
import { WebhookSigner } from './webhook-signer';

/** Max rows drained per tick — bounds a backlog into fixed-size chunks (CWE-770). */
const BATCH = 100;
/** Backoff base (2s) and cap (1h) for the full-jitter exponential retry. */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 60 * 60_000;
/** Terminal rows older than this are pruned so the table can't grow unbounded. */
const RETENTION_MS = 7 * 24 * 60 * 60_000; // 7 days
/** `lastError` column width — truncate so a long error can't overflow it. */
const LAST_ERROR_MAX = 512;

/**
 * Drains the `event_deliveries` outbox and POSTs each event to the configured
 * webhook URL with an HMAC-SHA256 signature (STORY-0801). Mirrors
 * `TrashPurgeRunner`: batched due-scan, reads the `Clock` (tests fast-forward
 * backoff), per-row failure isolation, and terminal-row pruning. Registered on
 * the in-process background tick; `BackgroundService.fire` already skips a tick
 * while the previous is in-flight, so a slow endpoint can't stack overlapping runs.
 *
 * Delivery is at-least-once: a crash after the endpoint returns 2xx but before
 * the row is marked `delivered` re-delivers, so receivers MUST dedupe on the
 * `X-OpenBucket-Delivery` id. Rows are processed in `next_attempt_at` order
 * (best-effort), NOT strictly per-key.
 *
 * SSRF / secrets (EPIC-08): the URL is operator-configured (not tenant-
 * controlled) and validated https/loopback at config time; redirects are NOT
 * followed (`redirect: 'manual'`, any 3xx is a failure); the response body is
 * discarded (only the status matters); the HMAC secret is never logged and
 * `lastError` records only the status code / error name.
 */
@Injectable()
export class WebhookDeliveryRunner implements ScheduledTask {
  readonly name = 'webhook-delivery';
  readonly intervalMs: number;
  private readonly log = new Logger(WebhookDeliveryRunner.name);

  constructor(
    private readonly repo: EventDeliveryRepository,
    private readonly config: AppConfigService,
    private readonly signer: WebhookSigner,
    private readonly clock: Clock,
  ) {
    this.intervalMs = config.webhookPollMs;
  }

  async run(): Promise<void> {
    if (!this.config.webhooksEnabled) return;

    const due = await this.repo.findDue(this.clock.now(), BATCH);
    for (const row of due) {
      await this.deliverOne(row);
      // Yield between rows so a large backlog doesn't starve request handlers.
      await new Promise((r) => setImmediate(r));
    }

    const pruned = await this.repo.pruneTerminal(this.clock.now(), RETENTION_MS);
    if (pruned > 0) this.log.debug(`webhook-delivery: pruned ${pruned} terminal row(s)`);
  }

  /** Deliver a single row, updating its status. Per-row isolated — a throw here
   *  is caught so one bad row can't abort the batch. */
  private async deliverOne(row: EventDeliveryEntity): Promise<void> {
    const em = this.repo.getEntityManager();
    try {
      const rawBody = row.payload;
      const { header } = this.signer.sign(rawBody, this.config.webhookSecret, this.clock.nowMs());

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.webhookTimeoutMs);
      let ok = false;
      let statusInfo: string;
      try {
        const res = await fetch(this.config.webhookUrl as string, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': `openbucket-webhooks/${OPENBUCKET_VERSION}`,
            'X-OpenBucket-Event': row.eventType,
            'X-OpenBucket-Delivery': row.id,
            'X-OpenBucket-Signature': header,
          },
          body: rawBody,
          // Never follow a redirect to a different origin — treat any 3xx as a failure.
          redirect: 'manual',
          signal: controller.signal,
        });
        ok = res.ok; // 2xx only
        statusInfo = `HTTP ${res.status}`;
        // We only need the status — discard the body so the socket is freed and
        // a large response can't be buffered (DoS).
        await res.body?.cancel().catch(() => undefined);
      } finally {
        clearTimeout(timer);
      }

      if (ok) {
        row.status = 'delivered';
        row.deliveredAt = this.clock.now();
        row.lastError = null;
      } else {
        this.markFailure(row, statusInfo);
      }
    } catch (err) {
      // Network error / timeout (AbortError). Record only the error NAME — never
      // the payload or the secret.
      const name = (err as Error).name || 'Error';
      this.markFailure(row, name === 'AbortError' ? 'timeout' : name);
    }

    try {
      await em.flush();
    } catch (err) {
      this.log.error(
        `webhook-delivery: failed to persist status for delivery ${row.id}`,
        err as Error,
      );
    }
  }

  /**
   * Non-2xx / network error / timeout: bump `attempts`; dead-letter to `failed`
   * once `attempts >= maxAttempts`, else keep `pending` with a jittered backoff.
   */
  private markFailure(row: EventDeliveryEntity, info: string): void {
    row.attempts += 1;
    row.lastError = info.slice(0, LAST_ERROR_MAX);
    if (row.attempts >= this.config.webhookMaxAttempts) {
      row.status = 'failed'; // dead-letter — stop retrying a permanently-down endpoint
    } else {
      row.status = 'pending';
      row.nextAttemptAt = new Date(this.clock.nowMs() + this.backoffMs(row.attempts));
    }
    this.log.warn(
      `webhook-delivery: delivery ${row.id} (${row.eventType}) failed [${info}] ` +
        `attempt ${row.attempts}/${this.config.webhookMaxAttempts} → ${row.status}`,
    );
  }

  /** Full-jitter exponential backoff: random(0, min(base * 2^attempts, cap)). */
  private backoffMs(attempts: number): number {
    const ceil = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
    return Math.floor(Math.random() * ceil);
  }
}
