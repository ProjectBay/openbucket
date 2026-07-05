import { ReplicationTargetService } from './replication-target.service';
import type { ReplicationConfig } from './replication-config';

/**
 * TEST-1203 — `listRemoteObjects` must filter BOTH reserved prefixes
 * (`_ob_tiered/` and `_ob_backups/`) so a reconcile scan (STORY-0902) never
 * treats a tiered blob or a pushed backup snapshot as a stray raw-key object.
 */
describe('ReplicationTargetService.listRemoteObjects reserved-prefix filter', () => {
  const config: ReplicationConfig = {
    enabled: true,
    region: 'us-east-1',
    bucket: 'target',
    accessKeyId: 'AKIA',
    secretAccessKey: 'k7Jf2pQrwStN9vB3zX1cM4dL0eR6yU2h',
    forcePathStyle: true,
    maxAttempts: 1,
    drainIntervalMs: 5_000,
    batchKeys: 50,
    largeObjectThresholdBytes: 64 * 1024 * 1024,
  };

  it('drops _ob_tiered/ and _ob_backups/ keys, keeps raw-key objects', async () => {
    const svc = new ReplicationTargetService(config);
    const send = jest.fn().mockResolvedValue({
      Contents: [
        { Key: 'photos/a.jpg', Size: 10, ETag: '"e1"' },
        { Key: '_ob_tiered/bucket/cold.bin', Size: 20, ETag: '"e2"' },
        { Key: '_ob_backups/instance/20260705T000000Z-x.zip', Size: 30, ETag: '"e3"' },
        { Key: 'docs/b.txt', Size: 40, ETag: '"e4"' },
      ],
      IsTruncated: false,
    });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = send;

    const page = await svc.listRemoteObjects({ maxKeys: 100 });
    expect(page.objects.map((o) => o.key)).toEqual(['photos/a.jpg', 'docs/b.txt']);
    expect(page.isTruncated).toBe(false);

    svc.destroy();
  });
});
