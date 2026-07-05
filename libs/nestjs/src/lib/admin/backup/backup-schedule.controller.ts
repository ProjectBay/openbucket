import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { ScheduledBackupService } from './scheduled-backup.service';
import { RunNowResultDto, ScheduleStatusDto } from './dto/schedule-status.dto';

/**
 * Scheduled-backup admin JSON API (STORY-1203, §5). Split out from the binary
 * `BackupController` (which stays `@ApiExcludeController` — its .zip stream
 * endpoints can't be meaningfully typed by the api-client) so these two JSON
 * routes ARE included in the OpenAPI document and generate a typed
 * `BackupScheduleService` in the api-client.
 *
 * Both routes are behind the global `AdminModule` JWT guard (same as every
 * `api/admin/*` route) + the admin-surface rate limits — no new authz wiring.
 * `getStatus()` returns a REDACTED DTO (counts / timestamps / policy only —
 * never `dir`, credentials, or keys). Run-now shares `ScheduledBackupService`
 * with the scheduled tick, so both take the same path + in-flight lock.
 */
@Controller('api/admin/backup/schedule')
export class BackupScheduleController {
  constructor(private readonly scheduled: ScheduledBackupService) {}

  @Get()
  @ApiOperation({ operationId: 'getBackupSchedule' })
  @ApiOkResponse({ type: ScheduleStatusDto })
  scheduleStatus(): Promise<ScheduleStatusDto> {
    return this.scheduled.getStatus() as Promise<ScheduleStatusDto>;
  }

  @Post('run-now')
  @HttpCode(202)
  @ApiOperation({ operationId: 'runBackupNow' })
  @ApiResponse({ status: 202, type: RunNowResultDto })
  runNow(): RunNowResultDto {
    // The in-flight join (inside the service) is the hard DoS guard: a concurrent
    // call returns `{ started: false }` rather than launching a second snapshot.
    return this.scheduled.runNowOrJoin();
  }
}
