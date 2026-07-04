import { AppConfigService } from '../common/config/app-config.service';
import { InsufficientStorageError } from '../s3/errors/s3-error';
import { FreeSpaceService } from './free-space.service';

/**
 * TEST-0704 — free-space preflight guard (TASK-2140, CWE-770). The volume's
 * available-bytes seam is stubbed so the figure is deterministic.
 */
const mkConfig = (reserve: number): AppConfigService =>
  ({ dataDir: '/data', dataDirMinFreeBytes: reserve }) as unknown as AppConfigService;

type Seam = { availableBytes: () => Promise<number> };
const stubAvail = (svc: FreeSpaceService, impl: () => Promise<number>): jest.SpyInstance =>
  jest.spyOn(svc as unknown as Seam, 'availableBytes').mockImplementation(impl);

describe('FreeSpaceService (TEST-0704)', () => {
  it('throws InsufficientStorageError when free space is below the reserve', async () => {
    const svc = new FreeSpaceService(mkConfig(100 * 1024 * 1024)); // 100 MiB reserve
    stubAvail(svc, async () => 50 * 1024 * 1024); // 50 MiB free
    await expect(svc.assertWritable()).rejects.toBeInstanceOf(InsufficientStorageError);
  });

  it('accounts for the incoming bytes when checking the reserve', async () => {
    const svc = new FreeSpaceService(mkConfig(100 * 1024 * 1024));
    stubAvail(svc, async () => 120 * 1024 * 1024); // 120 MiB free
    // 120 - 30 = 90 MiB < 100 MiB reserve → reject.
    await expect(svc.assertWritable(30 * 1024 * 1024)).rejects.toBeInstanceOf(InsufficientStorageError);
  });

  it('allows the write when free space stays above the reserve', async () => {
    const svc = new FreeSpaceService(mkConfig(100 * 1024 * 1024));
    stubAvail(svc, async () => 500 * 1024 * 1024); // 500 MiB free
    await expect(svc.assertWritable(1024)).resolves.toBeUndefined();
  });

  it('is a no-op (never queries the volume) when the reserve is 0 (disabled)', async () => {
    const svc = new FreeSpaceService(mkConfig(0));
    const spy = stubAvail(svc, async () => 1);
    await expect(svc.assertWritable(Number.MAX_SAFE_INTEGER)).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('fails open (allows the write) when the volume query itself errors', async () => {
    const svc = new FreeSpaceService(mkConfig(100 * 1024 * 1024));
    stubAvail(svc, async () => {
      throw new Error('EIO');
    });
    await expect(svc.assertWritable()).resolves.toBeUndefined();
  });
});
