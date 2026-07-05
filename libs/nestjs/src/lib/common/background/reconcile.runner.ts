import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/libsql';
import { InjectEntityManager } from '@mikro-orm/nestjs';

import { ObjectService } from '../../domain/objects/object.service';
import { ReconcileService } from '../../domain/replication/reconcile.service';
import { Bucket } from '../../persistence/entities/bucket.entity';
import type { ReconcileJob } from '../../persistence/entities/reconcile-job.entity';
import { BucketRepository } from '../../persistence/repositories/bucket.repository';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';
import { decodeKey } from '../../storage/key-codec';
import {
  REPLICATION_CONFIG,
  type ReplicationConfig,
} from '../../storage/replication/replication-config';
import { ReplicationOutboxService } from '../../storage/replication/replication-outbox.service';
import {
  type RemoteObjectRef,
  ReplicationTargetService,
} from '../../storage/replication/replication-target.service';
import { AuditService } from '../../admin/audit/audit.service';
import { ScheduledTask } from './background.service';

/** Local objects fetched per DB page. */
export const BATCH_SIZE = 500;
/** Local batches processed per tick before pausing (resumes via the cursor). */
export const MAX_BATCHES_PER_TICK = 10;
/** Remote `ListObjectsV2` pages fetched to cover a single local batch window. */
const REMOTE_MAX_PAGES_PER_BATCH = 4;
/** Bounded, redacted job error length. */
const ERROR_MAX = 400;

/**
 * Executes reconcile/backfill jobs on the §4.9 background tick (STORY-0902). Each
 * tick claims the single active job (marks it `running`), then processes a
 * BOUNDED slice: it pages local objects (the same indexed range scan the
 * `LifecycleSweepRunner` uses), diffs each against a `ListObjectsV2` window on the
 * remote target, and re-enqueues any object missing (or size-divergent) on the
 * remote into the `replication_outbox` via `ReplicationOutboxService.enqueue`.
 *
 * Bounded + durable: at most `BATCH_SIZE * MAX_BATCHES_PER_TICK` local objects per
 * tick, resuming next tick from the persisted `(cursorBucket, cursorKey)` — a huge
 * bucket never loads whole into memory and the EM is never held open across a full
 * scan (a `setImmediate` yield between batches). One-way local→remote: an object
 * that exists remotely but not locally is counted (`remoteScanned`) but never
 * deleted (v1 EPIC-10 scope). Key comparison is via `decodeKey` on BOTH sides so
 * `/`, UTF-8 and `%XX` keys line up and are not double-requeued.
 *
 * Security/DoS: single-flight (one job) + the 5s tick + the per-tick batch cap
 * bound remote-listing load. A remote-list failure marks the job `failed` with a
 * REDACTED message (no endpoint/credential) rather than looping forever.
 */
@Injectable()
export class ReconcileRunner implements ScheduledTask {
  readonly name = 'reconcile';
  readonly intervalMs = 5_000;
  private readonly log = new Logger(ReconcileRunner.name);

  constructor(
    @InjectEntityManager(OPEN_BUCKET_ORM_CONTEXT) private readonly em: EntityManager,
    @Inject(REPLICATION_CONFIG) private readonly config: ReplicationConfig,
    private readonly reconcile: ReconcileService,
    private readonly objects: ObjectService,
    private readonly buckets: BucketRepository,
    private readonly target: ReplicationTargetService,
    private readonly outbox: ReplicationOutboxService,
    private readonly audit: AuditService,
  ) {}

  async run(): Promise<void> {
    // No target configured → nothing to reconcile against (mirrors the drain
    // worker's disabled no-op). A queued job on a since-disabled instance is
    // simply left untouched.
    if (!this.config.enabled) return;

    const job = await this.reconcile.claimNext();
    if (!job) return;

    try {
      await this.process(job);
    } catch (err) {
      this.log.error(`reconcile job ${job.id} failed`, err as Error);
      await this.reconcile.markTerminal(job, 'failed', this.redactError(err));
    }
  }

  /** Process a bounded slice of the job, persisting progress + cursor per batch. */
  private async process(job: ReconcileJob): Promise<void> {
    const scopeBuckets = await this.scopeBuckets(job);
    let batches = 0;

    for (let i = 0; i < scopeBuckets.length; i++) {
      const bucketName = scopeBuckets[i];
      // Resume mid-bucket only for the cursor bucket; later buckets start fresh.
      let marker = bucketName === job.cursorBucket ? job.cursorKey ?? undefined : undefined;

      for (;;) {
        if (batches >= MAX_BATCHES_PER_TICK) {
          // Pause: persist the resume point so the next tick continues here.
          job.cursorBucket = bucketName;
          job.cursorKey = marker;
          await this.reconcile.persistProgress(job);
          this.log.log(`reconcile ${job.id} paused at ${bucketName}/${marker ?? ''}`);
          return;
        }

        const page = await this.objects.list({ bucket: bucketName, marker, limit: BATCH_SIZE });
        if (page.contents.length === 0) break; // bucket exhausted → next bucket

        const lastKey = page.contents[page.contents.length - 1].key;
        const { remote, scanned } = await this.remoteWindow(marker, lastKey);

        const missing: string[] = [];
        for (const obj of page.contents) {
          const dk = decodeKey(obj.key);
          const hit = remote.get(dk);
          // Missing, or a size divergence (etags are not comparable across S3
          // implementations, so size is the robust one-way signal).
          if (!hit || (hit.size != null && hit.size !== obj.size)) missing.push(obj.key);
        }

        if (missing.length > 0) {
          await this.em.transactional(async (tem) => {
            // `name` is the Bucket PK; a reference avoids loading the row. The
            // cast bridges the ReflectMetadata PK-type inference gap.
            const bucketRef = tem.getReference(Bucket, bucketName as unknown as Bucket);
            for (const key of missing) {
              // Idempotent in effect: the drain worker coalesces per-key, and a
              // re-run after drain finds the object present remotely → requeues 0.
              this.outbox.enqueue(tem, { bucket: bucketRef, key, op: 'PUT' });
            }
          });
        }

        job.localScanned += page.contents.length;
        job.remoteScanned += scanned;
        job.missingRequeued += missing.length;
        job.cursorBucket = bucketName;
        job.cursorKey = lastKey;
        await this.reconcile.persistProgress(job);

        marker = lastKey;
        batches += 1;
        // Yield so request handlers aren't starved and the EM identity map for
        // the next batch starts clean.
        await new Promise((r) => setImmediate(r));
      }
    }

    // All in-scope buckets fully scanned → complete + audit.
    await this.reconcile.markTerminal(job, 'completed');
    this.audit.emit({
      event: 'replication.reconcile.completed',
      subject: job.subject ?? 'system',
      jobId: job.id,
      localScanned: job.localScanned,
      remoteScanned: job.remoteScanned,
      missingRequeued: job.missingRequeued,
    });
  }

  /** The ordered bucket names in the job's scope (sorted for a stable cursor). */
  private async scopeBuckets(job: ReconcileJob): Promise<string[]> {
    if (job.scope === 'bucket') return job.bucket ? [job.bucket] : [];
    const all = (await this.buckets.listAll()).map((b) => b.name).sort();
    // Instance scope resumes at/after the cursor bucket (a since-deleted cursor
    // bucket simply drops out — remaining buckets still get scanned).
    return job.cursorBucket ? all.filter((n) => n >= job.cursorBucket!) : all;
  }

  /**
   * Collect the remote raw-key window covering one local batch. Pages
   * `ListObjectsV2` from `startAfter` until the last remote key reaches the
   * batch's `upToKey` (or the remote is exhausted / a small page cap is hit),
   * keyed by `decodeKey` so it lines up with the decoded local keys. Tiered blobs
   * are already filtered out by `ReplicationTargetService`.
   */
  private async remoteWindow(
    startAfter: string | undefined,
    upToKey: string,
  ): Promise<{ remote: Map<string, RemoteObjectRef>; scanned: number }> {
    const remote = new Map<string, RemoteObjectRef>();
    let scanned = 0;
    let after = startAfter;

    for (let p = 0; p < REMOTE_MAX_PAGES_PER_BATCH; p++) {
      const pageResult = await this.target.listRemoteObjects({ startAfter: after, maxKeys: BATCH_SIZE });
      for (const o of pageResult.objects) {
        remote.set(decodeKey(o.key), o);
        scanned += 1;
      }
      const lastRaw = pageResult.objects.length
        ? pageResult.objects[pageResult.objects.length - 1].key
        : undefined;
      if (!pageResult.isTruncated || !lastRaw || lastRaw >= upToKey) break;
      after = lastRaw;
    }
    return { remote, scanned };
  }

  /** Build a bounded failure message with the remote endpoint/bucket/credentials
   *  scrubbed out (defence in depth — the message must never leak the target). */
  private redactError(err: unknown): string {
    const e = err as { name?: string; message?: string };
    let msg = e?.message ?? String(err);
    // Drop any URL (could embed the remote endpoint) and the configured target
    // coordinates.
    msg = msg.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '[remote]');
    for (const secret of [this.config.endpoint, this.config.bucket, this.config.accessKeyId]) {
      if (secret) msg = msg.split(secret).join('[redacted]');
    }
    return `${e?.name ?? 'Error'}: ${msg}`.slice(0, ERROR_MAX);
  }
}
