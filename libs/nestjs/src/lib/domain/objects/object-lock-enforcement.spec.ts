import {
  ObjectLockMode,
  type BucketRepository,
  type ObjectEntity,
  type ObjectRepository,
} from '../../persistence/index';

import { AccessDeniedError } from '../../s3/errors/s3-error';
import type { BlobStore } from '../../storage/blob-store';
import type { ObjectWriterService } from '../../storage/object-writer.service';
import type { SseKeyService } from '../../storage/sse-key.service';
import type { VersionStoreService } from '../../storage/version-store.service';
import type { XmlSerializer } from '../../s3/xml/xml.serializer';
import { ObjectService } from './object.service';

/**
 * STORY-0121 — object-lock enforcement on the unversioned soft-delete path
 * (the one that actually removes data). Drives `deleteOne` with a mocked
 * unversioned bucket + a single locked row; asserts the §10 WORM rules.
 */
function mkSvc(lock: unknown, onCommit?: () => void): ObjectService {
  const row = { lock, softDeleted: false } as unknown as ObjectEntity;
  const em = {
    begin: async () => undefined,
    commit: async () => onCommit?.(),
    rollback: async () => undefined,
    findOne: async () => row,
    persist: () => undefined,
  };
  const objects = { getEntityManager: () => ({ fork: () => em }) } as unknown as ObjectRepository;
  const buckets = { hasVersionHistory: async () => false } as unknown as BucketRepository;
  const blobs = { deleteBlob: async () => undefined } as unknown as BlobStore;
  return new ObjectService(
    {} as ObjectWriterService,
    buckets,
    objects,
    blobs,
    {} as VersionStoreService,
    {} as XmlSerializer,
    {} as SseKeyService,
  );
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe('ObjectService.deleteOne — object-lock enforcement (STORY-0121)', () => {
  it('blocks delete under a legal hold → AccessDenied', async () => {
    const svc = mkSvc({ mode: ObjectLockMode.Off, legalHold: true });
    await expect(svc.deleteOne('b', 'k')).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('blocks delete under COMPLIANCE retention even with bypass', async () => {
    const svc = mkSvc({ mode: ObjectLockMode.Compliance, retainUntil: future });
    await expect(svc.deleteOne('b', 'k', undefined, true)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('blocks delete under GOVERNANCE retention without bypass', async () => {
    const svc = mkSvc({ mode: ObjectLockMode.Governance, retainUntil: future });
    await expect(svc.deleteOne('b', 'k')).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('allows GOVERNANCE delete WITH x-amz-bypass-governance-retention', async () => {
    let committed = false;
    const svc = mkSvc({ mode: ObjectLockMode.Governance, retainUntil: future }, () => (committed = true));
    await expect(svc.deleteOne('b', 'k', undefined, true)).resolves.toEqual({});
    expect(committed).toBe(true);
  });

  it('allows delete once retention has expired', async () => {
    const svc = mkSvc({ mode: ObjectLockMode.Compliance, retainUntil: past });
    await expect(svc.deleteOne('b', 'k')).resolves.toEqual({});
  });

  it('allows delete when no lock is set', async () => {
    const svc = mkSvc(undefined);
    await expect(svc.deleteOne('b', 'k')).resolves.toEqual({});
  });
});
