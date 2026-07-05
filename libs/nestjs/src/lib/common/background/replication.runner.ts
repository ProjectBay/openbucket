import { Inject, Injectable, Logger } from '@nestjs/common';

import { ObjectService } from '../../domain/objects/object.service';
import type { ReplicationOutbox } from '../../persistence/entities/replication-outbox.entity';
import { ReplicationOutboxRepository } from '../../persistence/repositories/replication-outbox.repository';
import {
  REPLICATION_CONFIG,
  type ReplicationConfig,
} from '../../storage/replication/replication-config';
import { ReplicationTargetService } from '../../storage/replication/replication-target.service';
import { Clock } from '../clock/clock';
import { ScheduledTask } from './background.service';

/** Backoff base (1s) and cap (5min) for the full-jitter exponential retry. */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 5 * 60_000;
/** `last_error` column truncation so a long remote error can't overflow it. */
const LAST_ERROR_MAX = 500;

/**
 * Drains the `replication_outbox` to the external S3-compatible target on the
 * §4.9 background tick (STORY-0900). Mirrors `WebhookDeliveryRunner`: a bounded
 * due-scan, reads the `Clock` (tests fast-forward backoff), per-key failure
 * isolation, exponential-backoff retry, and a dead-letter cap.
 *
 * Guarantees:
 *  - **Per-key ordering + coalescing** — a key's pending intents are read in
 *    `seq ASC` order; only the LAST intent determines the remote state, so the
 *    worker acts on it and marks every earlier one `done` (superseded). This is
 *    last-writer-wins and converges the remote to the local current visible
 *    state (`PUT,PUT` → one PUT; `PUT,DELETE` → one DELETE; etc.).
 *  - **Cross-key parallelism** — distinct keys are independent, so the batch is
 *    processed with `Promise.all` bounded by `config.batchKeys`; within a key the
 *    chain is strictly serial. The scheduler's no-pileup guard means only one
 *    tick runs at a time, so there is no cross-tick double-claim and no in-memory
 *    claim table is needed.
 *  - **Resume-on-boot / no lost intents** — intents are durable (committed with
 *    the write), so the first tick after boot picks up all due `pending` rows.
 *    There is no persisted `inflight` state (single process + no-pileup guard):
 *    a crash mid-send simply leaves the intent `pending` and it is retried. PUT
 *    is idempotent by key; DELETE is idempotent (a 404 on the remote is success).
 *
 * Security/DoS: the worker sends object PLAINTEXT (SSE decrypted by
 * `openObjectStream`) — the config factory warns on `http://` endpoints. Per-tick
 * work is bounded by `batchKeys`, backoff throttles a degraded remote, and the
 * dead-letter cap stops an un-replicable object from being retried forever. Each
 * in-flight PUT holds one source fd (bounded by `batchKeys`) and destroys the
 * stream on send failure.
 */
@Injectable()
export class ReplicationWorkerRunner implements ScheduledTask {
  readonly name = 'replication-drain';
  readonly intervalMs: number;
  private readonly log = new Logger(ReplicationWorkerRunner.name);

  constructor(
    @Inject(REPLICATION_CONFIG) private readonly config: ReplicationConfig,
    private readonly repo: ReplicationOutboxRepository,
    private readonly target: ReplicationTargetService,
    private readonly objects: ObjectService,
    private readonly clock: Clock,
  ) {
    this.intervalMs = config.drainIntervalMs;
  }

  async run(): Promise<void> {
    // Registered unconditionally (like the other runners); no-op when replication
    // is off so the tick "schedules nothing" per the story AC.
    if (!this.config.enabled) return;

    const keys = await this.repo.dueKeys(this.clock.now(), this.config.batchKeys);
    if (keys.length === 0) return;

    // Distinct keys are independent → cross-key parallelism is safe. `batchKeys`
    // bounds the fan-out (and so the in-flight fd/socket count).
    await Promise.all(keys.map((k) => this.drainKeySafe(k.bucket, k.key)));
  }

  /** Per-key isolation: a throw here (DB or remote error) must never abort the
   *  whole tick or reject the batch `Promise.all`. */
  private async drainKeySafe(bucket: string, key: string): Promise<void> {
    try {
      await this.drainKey(bucket, key);
    } catch (err) {
      this.log.error(
        `replication-drain: unexpected error draining ${bucket}/${key}`,
        err as Error,
      );
    }
  }

  private async drainKey(bucket: string, key: string): Promise<void> {
    const em = this.repo.getEntityManager();
    const chain = await this.repo.pendingForKey(bucket, key);
    if (chain.length === 0) return;

    const last = chain[chain.length - 1];
    // Every earlier intent is superseded by `last` regardless of the send outcome
    // (the remote only needs the final state), so mark them `done` up front.
    for (let i = 0; i < chain.length - 1; i++) chain[i].status = 'done';

    try {
      await this.send(last, bucket, key);
      last.status = 'done';
      await em.flush();
      // Retention: drop the coalesced/acted rows now the send succeeded so the
      // table stays small (STORY-0902 can add a keep-window if history is wanted).
      await this.repo.deleteDoneForKey(bucket, key);
    } catch (err) {
      // Persist the superseded `done` marks + the failure/backoff on `last`. A
      // per-key failure is recorded, never rethrown (mirrors TrashPurgeRunner).
      this.markFailure(last, err, bucket, key);
      try {
        await em.flush();
      } catch (flushErr) {
        this.log.error(
          `replication-drain: failed to persist status for ${bucket}/${key}`,
          flushErr as Error,
        );
      }
    }
  }

  /** Act on the coalesced last intent: PUT streams current plaintext bytes to the
   *  target; DELETE removes the remote key. A since-deleted object (PUT whose
   *  bytes are gone) is a no-op success — a later DELETE carries the real state. */
  private async send(intent: ReplicationOutbox, bucket: string, key: string): Promise<void> {
    if (intent.op === 'DELETE') {
      await this.target.deleteObject(key);
      return;
    }

    const opened = await this.objects.openObjectStream(bucket, key);
    if (!opened) return; // object since deleted — no-op success
    try {
      await this.target.putObject({
        key,
        body: opened.stream,
        contentLength: opened.size,
        contentType: opened.contentType,
      });
    } catch (err) {
      // Tear down the source fd so a failed send doesn't leak a descriptor.
      opened.stream.destroy();
      throw err;
    }
  }

  /**
   * Non-success: bump `attempts`; dead-letter to `failed` once
   * `attempts >= maxAttempts`, else keep `pending` with a jittered backoff so a
   * degraded remote isn't hammered and recovers gracefully.
   */
  private markFailure(intent: ReplicationOutbox, err: unknown, bucket: string, key: string): void {
    intent.attempts += 1;
    intent.lastError = ((err as Error)?.message ?? String(err)).slice(0, LAST_ERROR_MAX);
    if (intent.attempts >= this.config.maxAttempts) {
      intent.status = 'failed'; // dead-letter — stop retrying an un-replicable object
    } else {
      intent.status = 'pending';
      intent.nextAttemptAt = new Date(this.clock.nowMs() + this.backoffMs(intent.attempts));
    }
    this.log.warn(
      `replication-drain: ${intent.op} ${bucket}/${key} failed [${intent.lastError}] ` +
        `attempt ${intent.attempts}/${this.config.maxAttempts} → ${intent.status}`,
    );
  }

  /** Full-jitter exponential backoff: `min(base * 2^(attempts-1), cap) * rand(0.5..1.5)`. */
  private backoffMs(attempts: number): number {
    const ceil = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
    const jitter = 0.5 + Math.random(); // 0.5 .. 1.5
    return Math.floor(ceil * jitter);
  }
}
