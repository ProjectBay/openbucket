import type { Clock } from '../../common/clock/clock';
import type { ScheduledBackupService } from './scheduled-backup.service';
import type { ScheduledBackupConfig } from './scheduled-backup-config';
import { ScheduledBackupRunner } from './scheduled-backup.runner';

/** TEST-1203 — the background runner shell (TASK-3632): no-op when disabled,
 *  fires the shared service only when the schedule says a snapshot is due. */
describe('ScheduledBackupRunner', () => {
  const clock = { nowMs: () => 1_000 } as unknown as Clock;

  const makeSvc = (due: boolean) =>
    ({
      isDue: jest.fn().mockResolvedValue(due),
      runSnapshotCycle: jest.fn().mockResolvedValue(undefined),
    }) as unknown as ScheduledBackupService & { isDue: jest.Mock; runSnapshotCycle: jest.Mock };

  const config = (over: Partial<ScheduledBackupConfig>): ScheduledBackupConfig =>
    ({
      enabled: true,
      scope: 'instance',
      intervalMinutes: 60,
      dir: '/tmp/x',
      keepLast: 7,
      maxAgeDays: 30,
      checkIntervalMs: 60_000,
      pushToReplication: false,
      ...over,
    }) as ScheduledBackupConfig;

  it('intervalMs reflects the configured checkIntervalMs', () => {
    const runner = new ScheduledBackupRunner(config({ checkIntervalMs: 30_000 }), makeSvc(true), clock);
    expect(runner.intervalMs).toBe(30_000);
  });

  it('is a no-op when scheduling is disabled', async () => {
    const svc = makeSvc(true);
    const runner = new ScheduledBackupRunner(config({ enabled: false }), svc, clock);
    await runner.run();
    expect(svc.isDue).not.toHaveBeenCalled();
    expect(svc.runSnapshotCycle).not.toHaveBeenCalled();
  });

  it('does nothing when enabled but not due', async () => {
    const svc = makeSvc(false);
    const runner = new ScheduledBackupRunner(config({}), svc, clock);
    await runner.run();
    expect(svc.isDue).toHaveBeenCalledWith(1_000);
    expect(svc.runSnapshotCycle).not.toHaveBeenCalled();
  });

  it('runs a scheduled cycle when enabled and due', async () => {
    const svc = makeSvc(true);
    const runner = new ScheduledBackupRunner(config({}), svc, clock);
    await runner.run();
    expect(svc.runSnapshotCycle).toHaveBeenCalledWith('scheduled');
  });
});
