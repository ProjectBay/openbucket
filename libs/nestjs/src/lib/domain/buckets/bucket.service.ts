import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  Bucket,
  BucketRepository,
  CorsRule,
  LifecycleRule,
  ObjectEntity,
  ObjectLockBucketConfig,
  ObjectRepository,
  PolicyDocument,
  VersioningState,
} from '../../persistence/index';

import {
  BucketAlreadyOwnedByYouError,
  BucketNotEmptyError,
  InvalidArgumentError,
  MalformedPolicyError,
  MalformedXMLError,
  NoSuchBucketError,
  NoSuchBucketPolicyError,
  NoSuchCORSConfigurationError,
  NoSuchLifecycleConfigurationError,
  NoSuchTagSetError,
  NotImplementedError,
  ObjectLockConfigurationNotFoundError,
  S3Error,
  ServerSideEncryptionConfigurationNotFoundError,
} from '../../s3/errors/s3-error';
import { ContinuationToken } from '../../s3/pagination/continuation-token';
import {
  corsConfigDoc,
  encryptionConfigDoc,
  lifecycleConfigDoc,
  objectLockConfigDoc,
  ownerFullAclDoc,
  parseCorsConfig,
  parseEncryptionAlgorithm,
  parseLifecycleConfig,
  parseObjectLockConfig,
  parseTagSet,
  ROOT_OWNER,
  taggingDoc,
} from '../../s3/xml/s3-config-docs';
import { ObjectService } from '../objects/object.service';

// Re-exported here for back-compat: the ListBuckets / ListObjectVersions owner
// blocks and tests reference `ROOT_OWNER` from this module.
export { ROOT_OWNER };

const REGION = 'us-east-1';
const MAX_KEYS_CAP = 1000;

/** A bulk-delete target parsed from the `<Delete>` body. */
export interface DeleteEntry {
  key: string;
  versionId?: string;
}

/** Admin create-bucket input (§5.5). `versioning` is the request enum subset. */
export interface AdminCreateBucketInput {
  name: string;
  versioning: 'disabled' | 'enabled';
  objectLock: boolean;
  region: string;
}

/** A bucket plus its aggregate object stats, for admin listings (§5.5). */
export interface BucketWithStats {
  name: string;
  createdAt: Date;
  versioning: VersioningState;
  objectLock: boolean;
  stats: { objectCount: number; sizeBytes: number };
}

/**
 * Bucket-scope operations the `BucketController` dispatches to (§2.8.1/§2.8.2).
 * ListBuckets, the bucket lifecycle (Create/Delete/Head/Location), the listing
 * operations, the read-only stub endpoints, and bulk DeleteObjects are live
 * (STORY-0107/0108); Tagging/ACL/Policy/CORS/Versioning/Lifecycle/Encryption
 * land across STORY-0111-0117.
 */
@Injectable()
export class BucketService {
  constructor(
    private readonly buckets: BucketRepository,
    private readonly objects: ObjectRepository,
    private readonly objectSvc: ObjectService,
    private readonly tokens: ContinuationToken,
  ) {}

  // -------- Service scope (§2.8.1) -------------------------------------
  async listBuckets(_req: Request, _res: Response): Promise<unknown> {
    const rows = await this.buckets.listAll();
    return {
      __root: 'ListAllMyBucketsResult',
      Owner: { ID: ROOT_OWNER.ID, DisplayName: ROOT_OWNER.DisplayName },
      Buckets: {
        Bucket: rows.map((r) => ({ Name: r.name, CreationDate: r.createdAt.toISOString() })),
      },
    };
  }

  // -------- Bucket lifecycle (§2.8.2) ----------------------------------
  async createBucket(_req: Request, res: Response, bucket: string): Promise<undefined> {
    // Single-tenant: a re-create of an existing bucket is BucketAlreadyOwnedByYou
    // (AWS us-east-1 parity — never BucketAlreadyExists for the owner).
    if (await this.buckets.exists(bucket)) {
      throw new BucketAlreadyOwnedByYouError(
        'Your previous request to create the named bucket succeeded and you already own it.',
      );
    }
    const em = this.buckets.getEntityManager();
    const row = em.create(Bucket, { name: bucket, region: REGION });
    await em.persistAndFlush(row);
    res.setHeader('Location', `/${bucket}`);
    res.status(200);
    return undefined;
  }

  async deleteBucket(_req: Request, res: Response, bucket: string): Promise<undefined> {
    const row = await this.buckets.getByName(bucket);
    if (!row) throw new NoSuchBucketError(bucket);
    const objectCount = await this.objects.count({ bucket: { name: bucket }, softDeleted: false });
    if (objectCount > 0) {
      throw new BucketNotEmptyError('The bucket you tried to delete is not empty');
    }
    await this.buckets.getEntityManager().removeAndFlush(row);
    res.status(204);
    return undefined;
  }

  async headBucket(_req: Request, res: Response, bucket: string): Promise<undefined> {
    if (!(await this.buckets.exists(bucket))) throw new NoSuchBucketError(bucket);
    res.status(200);
    return undefined;
  }

  getLocation(): unknown {
    return { __root: 'LocationConstraint', '#text': REGION };
  }

  // -------- Listing (§2.8.2 / §2.10) -----------------------------------
  /**
   * GET /:bucket?list-type=2 — paginated listing with an HMAC-sealed
   * continuation token (§2.10). A continuation-token (bound to this bucket)
   * overrides the prefix/delimiter/start-after query params; the next token is
   * emitted only when the page is truncated.
   */
  async listObjectsV2(req: Request, _res: Response, bucket: string): Promise<unknown> {
    await this.requireBucket(bucket);
    const q = req.query as Record<string, unknown>;
    const maxKeys = qmax(q['max-keys'], MAX_KEYS_CAP, MAX_KEYS_CAP);

    const tokenStr = qstr(q['continuation-token']);
    const cursor = tokenStr ? this.tokens.decode(tokenStr, bucket) : undefined;

    const prefix = cursor?.prefix ?? qstr(q['prefix']) ?? '';
    const delimiter = cursor?.delimiter ?? qstr(q['delimiter']);
    const startAfter = qstr(q['start-after']);
    const marker = cursor?.afterKey ?? startAfter;

    const { rows, truncated } = await this.objects.listByPrefix(bucket, prefix, marker, maxKeys);
    const { contents, commonPrefixes } = groupByDelimiter(rows, prefix, delimiter ?? undefined);

    const nextToken =
      truncated && rows.length > 0
        ? this.tokens.encode({
            v: 1,
            b: bucket,
            afterKey: rows[rows.length - 1].key,
            prefix,
            delimiter: delimiter ?? null,
          })
        : undefined;

    return {
      __root: 'ListBucketResult',
      Name: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
      KeyCount: contents.length + commonPrefixes.length,
      IsTruncated: truncated,
      ...(delimiter ? { Delimiter: delimiter } : {}),
      ...(startAfter ? { StartAfter: startAfter } : {}),
      ...(tokenStr ? { ContinuationToken: tokenStr } : {}),
      ...(nextToken ? { NextContinuationToken: nextToken } : {}),
      Contents: contents.map((o) => ({
        Key: o.key,
        LastModified: o.modifiedAt.toISOString(),
        ETag: `"${o.etag}"`,
        Size: Number(o.size),
        StorageClass: o.storageClass,
      })),
      CommonPrefixes: commonPrefixes.map((p) => ({ Prefix: p })),
    };
  }

  async listObjectsV1(req: Request, bucket: string): Promise<unknown> {
    await this.requireBucket(bucket);
    const q = req.query as Record<string, unknown>;
    const prefix = qstr(q['prefix']) ?? '';
    const marker = qstr(q['marker']);
    const delimiter = qstr(q['delimiter']);
    const maxKeys = qmax(q['max-keys'], MAX_KEYS_CAP, MAX_KEYS_CAP);

    const { rows, truncated } = await this.objects.listByPrefix(bucket, prefix, marker, maxKeys);
    const { contents, commonPrefixes } = groupByDelimiter(rows, prefix, delimiter);
    const nextMarker = truncated && rows.length > 0 ? rows[rows.length - 1].key : undefined;

    return {
      __root: 'ListBucketResult',
      Name: bucket,
      Prefix: prefix,
      Marker: marker ?? '',
      ...(nextMarker ? { NextMarker: nextMarker } : {}),
      MaxKeys: maxKeys,
      ...(delimiter ? { Delimiter: delimiter } : {}),
      IsTruncated: truncated,
      Contents: contents.map((o) => ({
        Key: o.key,
        LastModified: o.modifiedAt.toISOString(),
        ETag: `"${o.etag}"`,
        Size: Number(o.size),
        StorageClass: o.storageClass,
      })),
      CommonPrefixes: commonPrefixes.map((p) => ({ Prefix: p })),
    };
  }

  async listObjectVersions(req: Request, bucket: string): Promise<unknown> {
    await this.requireBucket(bucket);
    const q = req.query as Record<string, unknown>;
    const prefix = qstr(q['prefix']) ?? '';
    const keyMarker = qstr(q['key-marker']);
    const versionIdMarker = qstr(q['version-id-marker']);
    const maxKeys = qmax(q['max-keys'], MAX_KEYS_CAP, MAX_KEYS_CAP);

    const rows = await this.objects.listVersionsByPrefix(
      bucket,
      prefix,
      keyMarker,
      versionIdMarker,
      maxKeys,
    );
    const truncated = rows.length > maxKeys;
    const page = rows.slice(0, maxKeys);
    const seenLatest = new Set<string>();
    const version: unknown[] = [];
    const deleteMarker: unknown[] = [];
    for (const v of page) {
      const isLatest = !seenLatest.has(v.key);
      seenLatest.add(v.key);
      const base = {
        Key: v.key,
        VersionId: v.versionId,
        IsLatest: isLatest,
        LastModified: v.createdAt.toISOString(),
      };
      if (v.isDeleteMarker) {
        deleteMarker.push({ ...base, Owner: owner() });
      } else {
        version.push({
          ...base,
          ETag: `"${v.etag}"`,
          Size: Number(v.size),
          StorageClass: 'STANDARD',
          Owner: owner(),
        });
      }
    }

    return {
      __root: 'ListVersionsResult',
      Name: bucket,
      Prefix: prefix,
      KeyMarker: keyMarker ?? '',
      VersionIdMarker: versionIdMarker ?? '',
      MaxKeys: maxKeys,
      IsTruncated: truncated,
      Version: version,
      DeleteMarker: deleteMarker,
    };
  }

  // -------- Read-only stub endpoints (§2.8.2 notes) --------------------
  getReplication(): never {
    // AWS returns a 404 with this distinct code when no replication config exists.
    throw new ReplicationConfigurationNotFoundError();
  }
  getNotification(): unknown {
    return { __root: 'NotificationConfiguration' };
  }
  putNotification(): never {
    throw new NotImplementedError('PutBucketNotificationConfiguration');
  }
  getAccelerate(): unknown {
    return { __root: 'AccelerateConfiguration', Status: 'Suspended' };
  }
  getLogging(): unknown {
    return { __root: 'BucketLoggingStatus' };
  }
  getRequestPayment(): unknown {
    return { __root: 'RequestPaymentConfiguration', Payer: 'BucketOwner' };
  }
  getWebsite(): never {
    throw new NotImplementedError('GetBucketWebsite');
  }
  putWebsite(): never {
    throw new NotImplementedError('PutBucketWebsite');
  }

  // -------- Bulk delete (§2.8.2 line 2540) -----------------------------
  /**
   * POST /:bucket?delete. Each entry is routed through the single-object
   * delete seam (`ObjectService.deleteOne`, STORY-0109); failures become
   * `<Error>` rows. `quiet` suppresses `<Deleted>` rows on success.
   */
  async bulkDelete(
    res: Response,
    bucket: string,
    entries: DeleteEntry[],
    quiet: boolean,
  ): Promise<unknown> {
    await this.requireBucket(bucket);
    const deleted: unknown[] = [];
    const errors: unknown[] = [];
    for (const entry of entries) {
      try {
        const result = await this.objectSvc.deleteOne(bucket, entry.key, entry.versionId);
        if (!quiet) {
          deleted.push({
            Key: entry.key,
            ...(entry.versionId ? { VersionId: entry.versionId } : {}),
            ...(result.deleteMarker ? { DeleteMarker: true } : {}),
            ...(result.versionId ? { DeleteMarkerVersionId: result.versionId } : {}),
          });
        }
      } catch (e) {
        errors.push({
          Key: entry.key,
          ...(entry.versionId ? { VersionId: entry.versionId } : {}),
          Code: errToCode(e),
          Message: (e as Error).message,
        });
      }
    }
    res.status(200);
    return { __root: 'DeleteResult', Deleted: deleted, Error: errors };
  }

  // ---- the remaining bucket-config ops land in STORY-0111-0117 --------
  // -------- Versioning (§2.8.2, STORY-0113) ---------------------------
  /** GET ?versioning — `<VersioningConfiguration>`; an empty doc (no `<Status>`)
   *  when versioning was never enabled (S3 returns no Status for Disabled). */
  async getVersioning(_req: Request, bucket: string): Promise<unknown> {
    const row = await this.loadBucket(bucket);
    const doc: Record<string, unknown> = { __root: 'VersioningConfiguration' };
    if (row.versioning === VersioningState.Enabled) doc.Status = 'Enabled';
    else if (row.versioning === VersioningState.Suspended) doc.Status = 'Suspended';
    return doc;
  }
  /** PUT ?versioning — persist Enabled/Suspended. MfaDelete is accepted and
   *  ignored (single-tenant, root-only). S3 has no transition back to Disabled. */
  async putVersioning(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    const status = (
      req as unknown as { xmlBody?: { VersioningConfiguration?: { Status?: unknown } } }
    ).xmlBody?.VersioningConfiguration?.Status;
    if (status === 'Enabled') row.versioning = VersioningState.Enabled;
    else if (status === 'Suspended') row.versioning = VersioningState.Suspended;
    else throw new MalformedXMLError('Invalid or missing versioning Status');
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  // -------- CORS (§2.8.2, STORY-0112) ---------------------------------
  /** GET ?cors — `<CORSConfiguration>`; `NoSuchCORSConfiguration` (404) if unset. */
  async getCors(_req: Request, bucket: string): Promise<unknown> {
    const row = await this.loadBucket(bucket);
    if (!row.cors || row.cors.length === 0) {
      throw new NoSuchCORSConfigurationError('The CORS configuration does not exist');
    }
    return corsConfigDoc(row.cors);
  }
  /** PUT ?cors — persist the parsed `<CORSConfiguration>` rules (drives STORY-0117). */
  async putCors(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.cors = parseCorsConfig((req as unknown as { xmlBody?: unknown }).xmlBody);
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  /** DELETE ?cors — clear the configuration; 204. */
  async deleteCors(_req: Request, res: Response, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.cors = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
    res.status(204);
    return undefined;
  }
  // -------- Lifecycle (§2.8.2, STORY-0114) ----------------------------
  /** GET ?lifecycle — `<LifecycleConfiguration>`; `NoSuchLifecycleConfiguration`
   *  (404) when no rules are configured. */
  async getLifecycle(_req: Request, bucket: string): Promise<unknown> {
    const row = await this.loadBucket(bucket);
    if (!row.lifecycle || row.lifecycle.length === 0) {
      throw new NoSuchLifecycleConfigurationError('The lifecycle configuration does not exist');
    }
    return lifecycleConfigDoc(row.lifecycle);
  }
  /** PUT ?lifecycle — persist the parsed `<LifecycleConfiguration>` rules (consumed
   *  by the background lifecycle sweep). Storage-class transitions are accepted and
   *  ignored (single tier); an empty rule set is rejected as MalformedXML. */
  async putLifecycle(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    const rules = parseLifecycleConfig((req as unknown as { xmlBody?: unknown }).xmlBody);
    if (rules.length === 0) {
      throw new MalformedXMLError('LifecycleConfiguration requires at least one Rule');
    }
    row.lifecycle = rules;
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  /** DELETE ?lifecycle — clear the configuration; 204. */
  async deleteLifecycle(_req: Request, res: Response, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.lifecycle = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
    res.status(204);
    return undefined;
  }
  // -------- Object Lock config (§2.8.2, STORY-0115) -------------------
  /** GET ?object-lock — `<ObjectLockConfiguration>`; `ObjectLockConfigurationNotFound`
   *  (404) when the bucket never had object lock enabled. */
  async getObjectLockConfig(_req: Request, bucket: string): Promise<unknown> {
    const row = await this.loadBucket(bucket);
    if (!row.objectLock?.enabled) throw new ObjectLockConfigurationNotFoundError();
    return objectLockConfigDoc(row.objectLock);
  }
  /** PUT ?object-lock — enable object lock + persist the optional DefaultRetention.
   *  Per-object retention/legal-hold land via ObjectService (§2.8.3). */
  async putObjectLockConfig(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.objectLock = parseObjectLockConfig((req as unknown as { xmlBody?: unknown }).xmlBody);
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  // -------- Tagging (§2.8.2, STORY-0111) -------------------------------
  /** GET ?tagging — `<Tagging>` doc; `NoSuchTagSet` (404) when no tags exist. */
  async getTagging(_req: Request, bucket: string): Promise<unknown> {
    const row = await this.loadBucket(bucket);
    if (!row.tagging || Object.keys(row.tagging).length === 0) {
      throw new NoSuchTagSetError('The TagSet does not exist');
    }
    return taggingDoc(row.tagging);
  }
  /** PUT ?tagging — persist the parsed `<Tagging>` body (replaces any prior). */
  async putTagging(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.tagging = parseTagSet((req as unknown as { xmlBody?: unknown }).xmlBody);
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  /** DELETE ?tagging — clear the tag set; 204. */
  async deleteTagging(_req: Request, res: Response, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.tagging = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
    res.status(204);
    return undefined;
  }

  // -------- ACL (§2.8.2, STORY-0111) — single-tenant owner-full -------
  /** GET ?acl — always the owner-full ACL, regardless of stored state. */
  async getBucketAcl(_req: Request, bucket: string): Promise<unknown> {
    await this.requireBucket(bucket);
    return ownerFullAclDoc();
  }
  /** PUT ?acl — accepted and ignored (single-tenant is always owner-full). */
  async putBucketAcl(_req: Request, bucket: string): Promise<undefined> {
    await this.requireBucket(bucket);
    return undefined;
  }

  // -------- Policy (§2.8.2, STORY-0111) — JSON body -------------------
  /** GET ?policy — the stored JSON verbatim; `NoSuchBucketPolicy` (404) if none. */
  async getPolicy(_req: Request, res: Response, bucket: string): Promise<string> {
    const row = await this.loadBucket(bucket);
    if (!row.policy) throw new NoSuchBucketPolicyError('The bucket policy does not exist');
    res.setHeader('Content-Type', 'application/json');
    return JSON.stringify(row.policy);
  }
  /** PUT ?policy — store the raw JSON body (read off `req.rawBody` by the
   *  XmlInterceptor's JSON-op path); `MalformedPolicy` (400) on bad JSON. */
  async putPolicy(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MalformedPolicyError();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MalformedPolicyError();
    }
    row.policy = parsed as PolicyDocument;
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  /** DELETE ?policy — clear the policy; 204. */
  async deletePolicy(_req: Request, res: Response, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.policy = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
    res.status(204);
    return undefined;
  }
  // -------- Encryption (§2.8.2, STORY-0116) — SSE-S3 only in v1 -------
  /** GET ?encryption — `<ServerSideEncryptionConfiguration>`;
   *  `ServerSideEncryptionConfigurationNotFound` (404) when unset. */
  async getEncryption(_req: Request, bucket: string): Promise<unknown> {
    const row = await this.loadBucket(bucket);
    if (!row.encryption) throw new ServerSideEncryptionConfigurationNotFoundError();
    return encryptionConfigDoc(row.encryption);
  }
  /** PUT ?encryption — set the bucket default-encryption config. When `AES256`,
   *  ObjectWriterService encrypts object payloads at rest (AES-256-CTR, per-object
   *  IV, STORY-0122). Only `AES256` is accepted; `aws:kms`/other → `InvalidArgument`. */
  async putEncryption(req: Request, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    const algorithm = parseEncryptionAlgorithm((req as unknown as { xmlBody?: unknown }).xmlBody);
    if (!algorithm) throw new MalformedXMLError('missing SSEAlgorithm');
    if (algorithm !== 'AES256') {
      throw new InvalidArgumentError(
        'Only SSE-S3 (AES256) is supported in v1',
        'SSEAlgorithm',
        algorithm,
      );
    }
    row.encryption = { algorithm: 'AES256' };
    await this.buckets.getEntityManager().persistAndFlush(row);
    return undefined;
  }
  /** DELETE ?encryption — clear the configuration; 204. */
  async deleteEncryption(_req: Request, res: Response, bucket: string): Promise<undefined> {
    const row = await this.loadBucket(bucket);
    row.encryption = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
    res.status(204);
    return undefined;
  }

  // -------- Admin API (§5.5) -------------------------------------------
  // Clean, HTTP-agnostic operations the admin controller adapts to JSON, as
  // opposed to the req/res S3 handlers above. They throw the same domain S3
  // errors, which the AdminExceptionFilter renders as JSON with the right status.

  /** Resolve a bucket by name, strict null. */
  async findByName(name: string): Promise<Bucket | null> {
    return this.buckets.getByName(name);
  }

  /** Create a bucket; rejects a re-create as BucketAlreadyOwnedByYou (409). */
  async create(input: AdminCreateBucketInput): Promise<Bucket> {
    if (await this.buckets.exists(input.name)) {
      throw new BucketAlreadyOwnedByYouError(
        'Your previous request to create the named bucket succeeded and you already own it.',
      );
    }
    const em = this.buckets.getEntityManager();
    const row = em.create(Bucket, {
      name: input.name,
      region: input.region,
      versioning: input.versioning === 'enabled' ? VersioningState.Enabled : VersioningState.Disabled,
      objectLock: input.objectLock ? { enabled: true } : undefined,
    });
    await em.persistAndFlush(row);
    return row;
  }

  /** Delete a bucket; NoSuchBucket (404) if absent, BucketNotEmpty (409) if non-empty. */
  async deleteByName(name: string): Promise<void> {
    const row = await this.buckets.getByName(name);
    if (!row) throw new NoSuchBucketError(name);
    const objectCount = await this.objects.count({ bucket: { name }, softDeleted: false });
    if (objectCount > 0) {
      throw new BucketNotEmptyError('The bucket you tried to delete is not empty');
    }
    await this.buckets.getEntityManager().removeAndFlush(row);
  }

  // ---- Bucket config (HTTP-agnostic JSON adapters for the admin API, STORY-0612)
  // Mirror the req/res S3 handlers above but take/return plain values so the admin
  // controller never fakes `req.xmlBody`. Same domain errors → same JSON statuses.

  /** Set versioning (Enabled/Suspended); returns {from,to} for the audit event. */
  async setVersioning(
    bucket: string,
    status: 'Enabled' | 'Suspended',
  ): Promise<{ from: VersioningState; to: VersioningState }> {
    const row = await this.loadBucket(bucket);
    const from = row.versioning;
    row.versioning =
      status === 'Enabled' ? VersioningState.Enabled : VersioningState.Suspended;
    await this.buckets.getEntityManager().persistAndFlush(row);
    return { from, to: row.versioning };
  }

  /** Bucket tag set as a plain map; NoSuchTagSet (404) when empty. */
  async getTaggingMap(bucket: string): Promise<Record<string, string>> {
    const row = await this.loadBucket(bucket);
    if (!row.tagging || Object.keys(row.tagging).length === 0) {
      throw new NoSuchTagSetError('The TagSet does not exist');
    }
    return row.tagging;
  }

  /** Replace the bucket tag set. */
  async setTagging(bucket: string, tags: Record<string, string>): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.tagging = tags;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Clear the bucket tag set. */
  async clearTagging(bucket: string): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.tagging = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Default SSE-S3 encryption config; NotFound (404) when unset. */
  async getEncryptionConfig(bucket: string): Promise<{ algorithm: 'AES256' }> {
    const row = await this.loadBucket(bucket);
    if (!row.encryption) throw new ServerSideEncryptionConfigurationNotFoundError();
    return { algorithm: 'AES256' };
  }

  /** Set default-encryption config (admin). `AES256` ⇒ objects are encrypted at
   *  rest (AES-256-CTR, STORY-0122); only `AES256` is accepted. */
  async setEncryption(bucket: string, algorithm: string): Promise<void> {
    if (algorithm !== 'AES256') {
      throw new InvalidArgumentError(
        'Only SSE-S3 (AES256) is supported in v1',
        'SSEAlgorithm',
        algorithm,
      );
    }
    const row = await this.loadBucket(bucket);
    row.encryption = { algorithm: 'AES256' };
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Clear default encryption. */
  async clearEncryption(bucket: string): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.encryption = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Lifecycle rules; NoSuchLifecycleConfiguration (404) when unset. */
  async getLifecycleRules(bucket: string): Promise<LifecycleRule[]> {
    const row = await this.loadBucket(bucket);
    if (!row.lifecycle || row.lifecycle.length === 0) {
      throw new NoSuchLifecycleConfigurationError('The lifecycle configuration does not exist');
    }
    return row.lifecycle;
  }

  /** Replace lifecycle rules; at least one rule required. */
  async setLifecycle(bucket: string, rules: LifecycleRule[]): Promise<void> {
    if (rules.length === 0) {
      throw new MalformedXMLError('LifecycleConfiguration requires at least one Rule');
    }
    const row = await this.loadBucket(bucket);
    row.lifecycle = rules;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Clear lifecycle rules. */
  async clearLifecycle(bucket: string): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.lifecycle = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** CORS rules; NoSuchCORSConfiguration (404) when empty. */
  async getCorsRules(bucket: string): Promise<CorsRule[]> {
    const row = await this.loadBucket(bucket);
    if (!row.cors || row.cors.length === 0) {
      throw new NoSuchCORSConfigurationError('The CORS configuration does not exist');
    }
    return row.cors;
  }

  /** Replace CORS rules. */
  async setCors(bucket: string, rules: CorsRule[]): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.cors = rules;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Clear CORS rules. */
  async clearCors(bucket: string): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.cors = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Object-lock config; ObjectLockConfigurationNotFound (404) when not enabled. */
  async getObjectLock(bucket: string): Promise<{
    enabled: boolean;
    mode?: 'off' | 'governance' | 'compliance';
    defaultRetentionDays?: number;
  }> {
    const row = await this.loadBucket(bucket);
    if (!row.objectLock?.enabled) throw new ObjectLockConfigurationNotFoundError();
    return row.objectLock as {
      enabled: boolean;
      mode?: 'off' | 'governance' | 'compliance';
      defaultRetentionDays?: number;
    };
  }

  /** Enable/update object-lock + its default retention. */
  async setObjectLock(
    bucket: string,
    config: { enabled: boolean; mode?: 'off' | 'governance' | 'compliance'; defaultRetentionDays?: number },
  ): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.objectLock = config as ObjectLockBucketConfig;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Bucket policy JSON; NoSuchBucketPolicy (404) when none. */
  async getPolicyDoc(bucket: string): Promise<PolicyDocument> {
    const row = await this.loadBucket(bucket);
    if (!row.policy) throw new NoSuchBucketPolicyError('The bucket policy does not exist');
    return row.policy;
  }

  /**
   * Bucket policy for request-path evaluation (TASK-2120): the stored document,
   * or `null` when the bucket has no policy *or* does not exist. Unlike
   * {@link getPolicyDoc} this never throws, so the `PolicyAuthorizationGuard`
   * can default-allow (and let the handler surface `NoSuchBucket`) instead of
   * turning a missing policy/bucket into a spurious 404 on e.g. CreateBucket.
   */
  async tryGetPolicyDoc(bucket: string): Promise<PolicyDocument | null> {
    const row = await this.buckets.getByName(bucket);
    return row?.policy ?? null;
  }

  /** Store the bucket policy JSON verbatim (MalformedPolicy 400 on a non-object). */
  async setPolicy(bucket: string, policy: Record<string, unknown>): Promise<void> {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new MalformedPolicyError();
    }
    const row = await this.loadBucket(bucket);
    row.policy = policy as unknown as PolicyDocument;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** Clear the bucket policy. */
  async clearPolicy(bucket: string): Promise<void> {
    const row = await this.loadBucket(bucket);
    row.policy = undefined;
    await this.buckets.getEntityManager().persistAndFlush(row);
  }

  /** List all buckets with their aggregate object stats. */
  async listWithStats(): Promise<BucketWithStats[]> {
    const rows = await this.buckets.listAll();
    const out: BucketWithStats[] = [];
    for (const b of rows) {
      const stats = await this.objectSvc.statsFor(b.name);
      out.push({
        name: b.name,
        createdAt: b.createdAt,
        versioning: b.versioning,
        objectLock: b.objectLock?.enabled ?? false,
        stats,
      });
    }
    return out;
  }

  // -------- Helpers ----------------------------------------------------
  private async requireBucket(bucket: string): Promise<void> {
    if (!(await this.buckets.exists(bucket))) throw new NoSuchBucketError(bucket);
  }

  /** Load a bucket row (managed, for mutation) or throw `NoSuchBucket` (404). */
  private async loadBucket(name: string): Promise<Bucket> {
    const row = await this.buckets.getByName(name);
    if (!row) throw new NoSuchBucketError(name);
    return row;
  }
}

function owner(): { ID: string; DisplayName: string } {
  return { ID: ROOT_OWNER.ID, DisplayName: ROOT_OWNER.DisplayName };
}

function qstr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function qmax(v: unknown, def: number, cap: number): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(n, cap);
}

/**
 * Split a flat key list into Contents and CommonPrefixes under S3 delimiter
 * semantics: a key whose remainder after `prefix` contains `delimiter` is
 * rolled up to the prefix ending at the first delimiter.
 */
function groupByDelimiter(
  rows: ObjectEntity[],
  prefix: string,
  delimiter: string | undefined,
): { contents: ObjectEntity[]; commonPrefixes: string[] } {
  if (!delimiter) return { contents: rows, commonPrefixes: [] };
  const contents: ObjectEntity[] = [];
  const commonPrefixes = new Set<string>();
  for (const o of rows) {
    const rest = o.key.slice(prefix.length);
    const idx = rest.indexOf(delimiter);
    if (idx !== -1) {
      commonPrefixes.add(prefix + rest.slice(0, idx + delimiter.length));
    } else {
      contents.push(o);
    }
  }
  return { contents, commonPrefixes: [...commonPrefixes] };
}

function errToCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'InternalError';
}

/**
 * 404 ReplicationConfigurationNotFoundError — AWS returns this distinct code
 * for `GET ?replication` when no replication config exists (§2.8.2). It is not
 * part of the general §2.6 taxonomy, so it is defined locally.
 */
class ReplicationConfigurationNotFoundError extends S3Error {
  readonly code = 'ReplicationConfigurationNotFoundError';
  readonly httpStatus = 404;
  constructor() {
    super('The replication configuration was not found');
  }
}
