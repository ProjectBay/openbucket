import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';

import { REPLICATION_CONFIG, type ReplicationConfig } from './replication-config';

export interface ReplicationPutInput {
  key: string;
  body: Readable;
  contentLength: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * Thin wrapper around `@aws-sdk/client-s3` that writes/deletes a single object on
 * the configured external target (STORY-0900). One `S3Client` is constructed in
 * the constructor ONLY when `config.enabled` — a disabled deployment never
 * touches the SDK. Both operations are plain awaited SDK calls: the SDK's own
 * retry is disabled (`maxAttempts: 1`) because retry/backoff is the WORKER's job
 * (a double retry loop would multiply the effective attempt budget).
 *
 * The service sends object PLAINTEXT (the worker decrypts SSE before calling it),
 * so a plaintext `http://` endpoint leaks contents — the config factory warns at
 * boot. `secretAccessKey` is held only in the client's credentials closure and
 * is never logged.
 */
@Injectable()
export class ReplicationTargetService {
  private readonly client?: S3Client;

  constructor(@Inject(REPLICATION_CONFIG) private readonly config: ReplicationConfig) {
    if (config.enabled) {
      this.client = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        // Retry/backoff is the worker's responsibility (per-key ordering +
        // dead-letter). Disable the SDK's own retry so a failure surfaces at once.
        maxAttempts: 1,
      });
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error('ReplicationTargetService: replication is not enabled');
    }
    return this.client;
  }

  /**
   * Write an object to the target. For a known `contentLength` below the
   * multipart threshold a single `PutObjectCommand` is used (the size is always
   * known — from the object row — so no multipart overhead on small objects).
   * Above the threshold `@aws-sdk/lib-storage` `Upload` streams the body as a
   * multipart upload so a multi-GB object never buffers in memory.
   */
  async putObject(input: ReplicationPutInput): Promise<void> {
    const client = this.requireClient();
    if (input.contentLength > this.config.largeObjectThresholdBytes) {
      const upload = new Upload({
        client,
        params: {
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        },
      });
      await upload.done();
      return;
    }
    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
  }

  /** Delete an object from the target. Idempotent — S3 DeleteObject returns 204
   *  whether or not the key existed, so a missing remote key is success. */
  async deleteObject(key: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  /** Release the underlying SDK sockets on shutdown. */
  destroy(): void {
    this.client?.destroy();
  }
}
