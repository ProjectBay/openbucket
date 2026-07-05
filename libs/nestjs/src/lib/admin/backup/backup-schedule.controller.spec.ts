import type { ScheduledBackupService, ScheduleStatus } from './scheduled-backup.service';
import { BackupScheduleController } from './backup-schedule.controller';

/** TEST-1203 (case 7) — the admin JSON endpoints (TASK-3634): a redacted status
 *  payload and a run-now that returns `{ started }` from the shared in-flight lock. */
describe('BackupScheduleController', () => {
  const status: ScheduleStatus = {
    enabled: true,
    scope: 'instance',
    schedule: { intervalMinutes: 60 },
    lastRunAt: '2026-07-05T00:00:00.000Z',
    nextRunAt: '2026-07-05T01:00:00.000Z',
    lastStatus: 'ok',
    lastError: null,
    lastDurationMs: 12,
    lastBytes: 34,
    lastObjectCount: 5,
    keepLast: 7,
    maxAgeDays: 30,
    snapshotCount: 3,
  };

  it('scheduleStatus returns the redacted status (no dir/credential/key fields)', async () => {
    const svc = { getStatus: jest.fn().mockResolvedValue(status) } as unknown as ScheduledBackupService;
    const controller = new BackupScheduleController(svc);
    const out = await controller.scheduleStatus();
    expect(out).toEqual(status);
    const keys = Object.keys(out);
    expect(keys).not.toContain('dir');
    expect(keys).not.toContain('secretAccessKey');
  });

  it('runNow returns { started: true } on the first call', () => {
    const svc = { runNowOrJoin: jest.fn().mockReturnValue({ started: true }) } as unknown as ScheduledBackupService;
    const controller = new BackupScheduleController(svc);
    expect(controller.runNow()).toEqual({ started: true });
  });

  it('runNow returns { started: false } while a cycle is already in flight', () => {
    const svc = { runNowOrJoin: jest.fn().mockReturnValue({ started: false }) } as unknown as ScheduledBackupService;
    const controller = new BackupScheduleController(svc);
    expect(controller.runNow()).toEqual({ started: false });
  });
});
