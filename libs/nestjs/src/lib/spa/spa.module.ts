import { Module } from '@nestjs/common';

import { SpaController } from './spa.controller';
import { resolveSpaRoot, SPA_ROOT } from './spa-utils';

/**
 * Serves the bundled admin SPA (when `admin.serveUi`). forRoot mounts it under
 * `<mountPath>/admin` via RouterModule. SPA_ROOT resolves the bundled asset dir
 * once at boot (null when the UI wasn't bundled into the build).
 */
@Module({
  controllers: [SpaController],
  providers: [{ provide: SPA_ROOT, useFactory: () => resolveSpaRoot() }],
})
export class SpaModule {}
