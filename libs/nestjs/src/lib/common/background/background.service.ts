import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { InjectMikroORM } from '@mikro-orm/nestjs';

import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/**
 * A recurring background task. Runners (multipart-cleanup, lifecycle-sweep,
 * trash-purge, …) implement this and register under {@link SCHEDULED_TASKS};
 * the scheduler discovers and schedules them, so it stays decoupled from the
 * specific runners (which land across separate stories/milestones).
 */
export interface ScheduledTask {
  readonly name: string;
  readonly intervalMs: number;
  run(): Promise<void>;
}

/** DI token for the (multi-provided) recurring tasks. */
export const SCHEDULED_TASKS = Symbol('SCHEDULED_TASKS');

interface TickHandle {
  readonly name: string;
  readonly intervalMs: number;
  readonly runner: () => Promise<void>;
  handle?: NodeJS.Timeout;
  inFlight?: Promise<void>;
}

/**
 * In-process background tick scheduler (WHITEPAPER §4.9). Runs each registered
 * task on its interval with three guarantees: no pile-up (a firing is skipped
 * if the previous tick is still running), a per-tick MikroORM `RequestContext`
 * (identity maps never leak between ticks or into request handlers), and a
 * cancellable shutdown (intervals cleared, the in-flight tick awaited).
 */
@Injectable()
export class BackgroundService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(BackgroundService.name);
  private readonly ticks: TickHandle[] = [];
  private shuttingDown = false;

  constructor(
    @InjectMikroORM(OPEN_BUCKET_ORM_CONTEXT) private readonly orm: MikroORM,
    @Optional() @Inject(SCHEDULED_TASKS) private readonly tasks: ScheduledTask[] = [],
  ) {}

  onApplicationBootstrap(): void {
    for (const task of this.tasks ?? []) {
      this.schedule(task.name, task.intervalMs, () => task.run());
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const t of this.ticks) {
      if (t.handle) clearInterval(t.handle);
      t.handle = undefined;
    }
    // Await any tick mid-execution. The shutdown hook bounds total time.
    await Promise.allSettled(this.ticks.map((t) => t.inFlight ?? Promise.resolve()));
  }

  /** One-shot run inside a fresh RequestContext (e.g. the boot-time orphan scan). */
  async runOnce(name: string, runner: () => Promise<void>): Promise<void> {
    try {
      await RequestContext.create(this.orm.em, async () => runner());
    } catch (err) {
      this.log.error(`One-shot ${name} failed`, err as Error);
    }
  }

  schedule(name: string, intervalMs: number, runner: () => Promise<void>): void {
    const tick: TickHandle = { name, intervalMs, runner };
    tick.handle = setInterval(() => this.fire(tick), intervalMs);
    // Don't keep the event loop alive just for ticks — the HTTP server does that.
    tick.handle.unref();
    this.ticks.push(tick);
  }

  private fire(tick: TickHandle): void {
    if (this.shuttingDown) return;
    if (tick.inFlight) {
      this.log.debug(`Skipping ${tick.name}: previous tick still running`);
      return;
    }
    tick.inFlight = this.execute(tick).finally(() => {
      tick.inFlight = undefined;
    });
  }

  private async execute(tick: TickHandle): Promise<void> {
    const started = Date.now();
    try {
      await RequestContext.create(this.orm.em, async () => {
        await tick.runner();
      });
    } catch (err) {
      this.log.error(`Tick ${tick.name} failed`, err as Error);
    } finally {
      const ms = Date.now() - started;
      if (ms > tick.intervalMs * 0.8) {
        this.log.warn(
          `Tick ${tick.name} took ${ms}ms (interval ${tick.intervalMs}ms) — risk of pile-up`,
        );
      }
    }
  }
}
