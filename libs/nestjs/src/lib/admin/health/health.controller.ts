import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../../common/auth/public.decorator';
import { ShutdownState } from '../../common/shutdown-state.service';

/**
 * Liveness + readiness probes. Deliberately not under /api/admin/auth/* and
 * exempt from the admin JWT guard — orchestrators probe without credentials.
 *
 * M0 reduction (WHITEPAPER §1.8): the full readiness probe also checks SQLite
 * reachability (MikroORM) and blob-store writability (BlobStoreHealth). Those
 * dependencies are owned by EPIC-03 and are wired in M1; until then readiness
 * reports only liveness + drain state. See the TODO in ready().
 */
@Controller('api/admin')
export class HealthController {
  constructor(private readonly shutdown: ShutdownState) {}

  /** Liveness — the process is alive and the event loop responds. */
  @Public()
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  /** Readiness — the process can serve traffic right now. */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    if (this.shutdown.isShuttingDown) {
      throw new ServiceUnavailableException({ status: 'draining' });
    }

    // TODO(M1/EPIC-03): add SQLite reachability (orm.em SELECT 1) and blob
    // store writability (BlobStoreHealth.canWrite()) checks here once the
    // persistence layer lands. See WHITEPAPER §1.8.

    return { status: 'ready' };
  }
}
