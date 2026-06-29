import { Module } from '@nestjs/common';

import { StorageModule } from '../../storage/storage.module';
import { BackgroundModule } from '../background/background.module';
import { ShutdownService } from './shutdown.service';

/**
 * Hosts the §4.12 graceful-shutdown coordinator. ShutdownService needs
 * BackgroundService (cancel ticks) and BlobStore (flush handles) for steps 3–4;
 * HttpAdapterHost, MikroORM and ShutdownState are all globally available
 * (Nest core, MikroOrmModule, @Global CommonModule respectively).
 */
@Module({
  imports: [BackgroundModule, StorageModule],
  providers: [ShutdownService],
})
export class ShutdownModule {}
