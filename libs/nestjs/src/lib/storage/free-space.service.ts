import { Injectable, Logger } from '@nestjs/common';
import { statfs } from 'node:fs/promises';

import { AppConfigService } from '../common/config/app-config.service';
import { InsufficientStorageError } from '../s3/errors/s3-error';

/**
 * Free-space preflight for the write path (TASK-2140, CWE-770). The SQLite
 * metadata DB and blob/staging data share `DATA_DIR`; without a reserve any
 * credential holder can fill the volume with object bytes or abandoned multipart
 * staging and deny the whole instance (writes fail, the DB can't checkpoint).
 *
 * `assertWritable` `statfs(DATA_DIR)`s and throws `InsufficientStorageError`
 * (HTTP 507) when the available bytes — minus the bytes about to be written —
 * would drop below `DATA_DIR_MIN_FREE_BYTES`. A reserve of 0 disables the guard.
 * It is called by {@link BlobStore.putBlob}/{@link BlobStore.putPart} before the
 * staging write stream opens, so one guard covers committed PutObject bytes and
 * multipart part staging alike.
 */
@Injectable()
export class FreeSpaceService {
  private readonly log = new Logger(FreeSpaceService.name);

  constructor(private readonly config: AppConfigService) {}

  /**
   * Throw `InsufficientStorageError` if writing `incomingBytes` more would leave
   * the DATA_DIR volume below the configured free-space reserve. `incomingBytes`
   * is best-effort — a streaming PUT of unknown length passes 0, so the guard
   * still rejects once the volume is already at/under the reserve.
   */
  async assertWritable(incomingBytes = 0): Promise<void> {
    const reserve = this.config.dataDirMinFreeBytes;
    if (reserve <= 0) return; // guard disabled

    let free: number;
    try {
      free = await this.availableBytes();
    } catch (err) {
      // A statfs failure must not silently disable the guard nor wrongly reject
      // a legitimate write — log and allow the write to proceed (the OS ENOSPC
      // on the actual write remains the hard backstop).
      this.log.warn(`statfs(${this.config.dataDir}) failed; skipping free-space guard: ${(err as Error).message}`);
      return;
    }

    if (free - incomingBytes < reserve) {
      throw new InsufficientStorageError(
        `insufficient free space on DATA_DIR: ${free} bytes available, reserve is ${reserve} bytes`,
      );
    }
  }

  /** Available bytes on the DATA_DIR volume. Split out as a seam for testing. */
  protected async availableBytes(): Promise<number> {
    const st = await statfs(this.config.dataDir);
    return st.bavail * st.bsize;
  }
}
