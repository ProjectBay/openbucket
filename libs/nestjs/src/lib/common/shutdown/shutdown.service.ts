import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { MikroORM } from '@mikro-orm/core';
import { InjectMikroORM } from '@mikro-orm/nestjs';
import { PinoLogger } from 'nestjs-pino';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';

import { BackgroundService } from '../background/background.service';
import { BlobStore } from '../../storage/blob-store';
import { ShutdownState } from '../shutdown-state.service';
import { OPEN_BUCKET_ORM_CONTEXT } from '../../persistence/orm-context';

/** §4.12: in-flight streams get this long to finish before forced destroy. */
const STREAM_DRAIN_DEADLINE_MS = 30_000;

/**
 * Graceful-shutdown coordinator (WHITEPAPER §4.12). Supersedes the M0 §1.10
 * signal coordinator (STORY-0015): `main.ts` enables Nest's shutdown hooks, so
 * SIGTERM/SIGINT fire `onApplicationShutdown` on every provider. This service
 * enforces a deterministic five-step order regardless of Nest's internal
 * provider ordering by calling `BackgroundService` / `BlobStore` / `MikroORM`
 * explicitly:
 *
 *   0. Flip readiness → /ready answers 503 (lets a load balancer drain us).
 *   1. Stop accepting new connections; end idle keep-alive sockets.
 *   2. Drain in-flight streams up to 30s, then destroy survivors.
 *   3. Cancel scheduler ticks and await the in-flight tick.
 *   4. Flush BlobStore handles.
 *   5. Close MikroORM / SQLite (checkpoints the WAL on better-sqlite3).
 *
 * Steps 3–5 are idempotent: Nest also invokes BackgroundService's and
 * MikroORM's own shutdown hooks, but BackgroundService guards on `shuttingDown`
 * and better-sqlite3's close is a no-op when already closed.
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly log = new Logger(ShutdownService.name);
  private readonly activeSockets = new Set<Socket>();

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(BackgroundService) private readonly background: BackgroundService,
    @Inject(BlobStore) private readonly blobs: BlobStore,
    @InjectMikroORM(OPEN_BUCKET_ORM_CONTEXT) private readonly orm: MikroORM,
    private readonly state: ShutdownState,
    private readonly pino: PinoLogger,
  ) {
    // Track every accepted socket so we can end/destroy them at the deadline.
    // The http.Server exists from NestFactory.create (before listen()), so this
    // listener is attached before any connection is accepted.
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    httpServer?.on('connection', (socket: Socket) => {
      this.activeSockets.add(socket);
      socket.once('close', () => this.activeSockets.delete(socket));
    });
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.log.log(`Shutdown initiated (signal=${signal})`);

    // (0) Readiness off — /ready returns 503 while we drain (M0 §1.10 behaviour
    //     preserved). Re-entrant-safe: ShutdownState.beginShutdown is a no-op
    //     once already shutting down.
    this.state.beginShutdown();

    // (1) Stop accepting new connections. Existing ones keep working.
    const httpServer: Server | undefined = this.adapterHost.httpAdapter?.getHttpServer();
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
      // server.close() does NOT close idle keep-alive sockets — end them so
      // they don't hold the close callback pending.
      for (const sock of this.activeSockets) {
        if (sock.writable && !sock.writableNeedDrain) {
          sock.end();
        }
      }
    });
    this.log.log('HTTP server stopped accepting new connections');

    // (2) Drain in-flight streams: give them up to 30s, then destroy.
    const drainStart = Date.now();
    while (this.activeSockets.size > 0) {
      if (Date.now() - drainStart >= STREAM_DRAIN_DEADLINE_MS) {
        this.log.warn(
          `Drain deadline reached with ${this.activeSockets.size} sockets — destroying`,
        );
        for (const sock of this.activeSockets) {
          sock.destroy();
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    this.log.log(`Stream drain complete in ${Date.now() - drainStart}ms`);

    // (3) Cancel scheduler ticks and await the in-flight tick. Called directly
    //     (not left to Nest's hook ordering) so it lands before the EM close;
    //     BackgroundService guards re-entrancy on `shuttingDown`.
    await this.background.onApplicationShutdown();
    this.log.log('Background ticks cancelled and drained');

    // (4) Flush BlobStore handles before the EM close so any final row updates
    //     land.
    await this.blobs.close?.();
    this.log.log('BlobStore closed');

    // (5) Close MikroORM last — every prior step may emit a final write. The
    //     `true` forces the close; better-sqlite3 checkpoints the WAL on the
    //     final-connection close, leaving the DB clean for the next boot.
    await this.orm.close(true);
    this.log.log('MikroORM closed');

    this.log.log('Shutdown complete');

    // pino's default stdout destination is asynchronous (sonic-boom, sync:false),
    // so every line logged above sits in an unflushed buffer when Nest re-raises
    // the termination signal and the process exits — they would never reach
    // stdout (lost from Docker logs and from the §4.12 drain assertions). Flush
    // the out-of-request logger before returning. `pino.logger` resolves to
    // nestjs-pino's module-level out-of-context instance here (we are outside any
    // request scope), which is the exact sink these shutdown lines were written
    // to via Nest's logger.
    await this.flushLogs();
  }

  private flushLogs(): Promise<void> {
    return new Promise<void>((resolve) => {
      const sink = this.pino.logger as {
        flush?: (cb?: (err?: Error) => void) => void;
      };
      if (typeof sink.flush === 'function') {
        sink.flush(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
