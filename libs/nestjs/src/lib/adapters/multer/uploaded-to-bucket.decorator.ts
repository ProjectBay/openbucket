import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { UploadedObject } from '../../open-bucket.service';
// Loaded for its side-effect: the `Express.Multer.File.openBucket` global
// augmentation this decorator reads back lives in `./open-bucket-storage`.
import './open-bucket-storage';

/**
 * The clean, handler-facing view of an object committed by
 * {@link openBucketStorage}. Every field is already computed and non-secret; the
 * `contentType` is the RESOLVED (sniffed) type — never the client's claim — and
 * `url`, when present, is a short-lived presigned GET url (no long-lived secret).
 *
 * Alias of the canonical {@link UploadedObject}.
 */
export type UploadedFileInfo = UploadedObject;

/** Map a multer file to {@link UploadedFileInfo}, or `undefined` when it was not committed. */
function toInfo(file: Express.Multer.File | undefined): UploadedFileInfo | undefined {
  const ob = file?.openBucket;
  if (!ob) return undefined; // absent, or handled by a different storage engine
  const info: UploadedFileInfo = {
    bucket: ob.bucket,
    key: ob.key,
    etag: ob.etag,
    size: ob.size ?? file?.size ?? 0,
    contentType: ob.contentType,
  };
  if (ob.url !== undefined) info.url = ob.url;
  if (ob.versionId !== undefined) info.versionId = ob.versionId;
  if (ob.image !== undefined) info.image = ob.image;
  return info;
}

/**
 * Resolver for {@link UploadedToBucket}, exported separately so it can be
 * unit-tested directly (Nest wraps the inner factory inside the decorator).
 *
 * Mirrors Nest's own `@UploadedFile` / `@UploadedFiles` resolution:
 *  1. `req.file` → a single {@link UploadedFileInfo} (or `undefined` when absent);
 *  2. `req.files` as an array → `UploadedFileInfo[]`;
 *  3. `req.files` as a fields map (`{ field: File[] }`) → that field's array when
 *     `field` is given, otherwise every field's files flattened.
 *
 * Never throws — a missing file yields `undefined` so the handler can raise its
 * own `BadRequestException('file is required')`, matching core Nest behaviour.
 */
export function uploadedToBucketFactory(
  field: string | undefined,
  ctx: ExecutionContext,
): UploadedFileInfo | UploadedFileInfo[] | undefined {
  const req = ctx.switchToHttp().getRequest<Request>();

  const single = req.file as Express.Multer.File | undefined;
  if (single) return toInfo(single);

  const files = req.files as
    | Express.Multer.File[]
    | Record<string, Express.Multer.File[]>
    | undefined;
  if (!files) return undefined;

  if (Array.isArray(files)) {
    return files.map(toInfo).filter((i): i is UploadedFileInfo => i !== undefined);
  }

  // Fields map: a specific field, else every field flattened.
  const groups = field !== undefined ? [files[field] ?? []] : Object.values(files);
  return groups
    .flat()
    .map(toInfo)
    .filter((i): i is UploadedFileInfo => i !== undefined);
}

/**
 * Param decorator that hands the handler the OpenBucket commit result that
 * {@link openBucketStorage} merged onto the uploaded file(s) — a clean
 * `{ bucket, key, url, etag, size, contentType }` — so a controller never reaches
 * into `file.openBucket` by hand. Supports the single-file (`req.file`), array,
 * and fields (`req.files`) interceptor shapes; pass a `field` name to pick one
 * field out of a `FileFieldsInterceptor`.
 */
export const UploadedToBucket = createParamDecorator(uploadedToBucketFactory);
