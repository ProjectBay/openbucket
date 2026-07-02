import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';

import { BackupService } from './backup.service';

/**
 * Admin backup & restore (§5.x). JWT-guarded by the global AdminModule guard.
 *   GET  /api/admin/backup                  → whole-instance .zip download
 *   POST /api/admin/restore                 → upload .zip, RESET the instance
 *   GET  /api/admin/buckets/:name/backup    → single-bucket .zip download
 *   POST /api/admin/buckets/:name/restore   → upload .zip, RESET that bucket
 *
 * Downloads use `@Res()` (library mode) — the service pipes the archive to the
 * response. Uploads read the raw request stream (global bodyParser is off), so
 * multi-hundred-MB archives spool to disk rather than into memory.
 *
 * Excluded from the OpenAPI document (@ApiExcludeController): these are binary
 * .zip stream endpoints the admin SPA calls via HttpClient (blob download / raw
 * upload), not through the generated typescript-angular api-client — which can't
 * meaningfully type a streamed body/response anyway.
 */
@ApiExcludeController()
@Controller('api/admin')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('backup')
  instanceBackup(@Res() res: Response): Promise<void> {
    return this.backup.streamInstanceBackup(res);
  }

  @Post('restore')
  instanceRestore(
    @Req() req: Request,
  ): Promise<{ bucketsRestored: number; objectsRestored: number }> {
    return this.backup.restoreInstance(req as unknown as Readable);
  }

  @Get('buckets/:name/backup')
  bucketBackup(@Param('name') name: string, @Res() res: Response): Promise<void> {
    return this.backup.streamBucketBackup(name, res);
  }

  @Post('buckets/:name/restore')
  bucketRestore(
    @Param('name') name: string,
    @Req() req: Request,
  ): Promise<{ objectsRestored: number }> {
    return this.backup.restoreBucket(name, req as unknown as Readable);
  }
}
