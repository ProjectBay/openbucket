import {
  ObjectLockMode,
  type CorsRule,
  type EncryptionConfig,
  type LifecycleRule,
  type ObjectLockBucketConfig,
  type ObjectLockObjectState,
  type TagSet,
} from '../../persistence/index';

import { MalformedXMLError } from '../errors/s3-error';

/**
 * Shared XML document shapes for the bucket/object sub-resource handlers
 * (Tagging / ACL — §2.8.2, §2.8.3). Kept as a leaf module (no service imports)
 * so both `BucketService` and `ObjectService` can use it without an import cycle.
 */

/**
 * Single-tenant owner identity surfaced in `<Owner>` / ACL `<Grantee>` blocks.
 * OpenBucket has exactly one owner in v1 (§2.8.1), so this is a stable constant
 * rather than a per-request canonical user. Re-exported by `BucketService` as
 * `ROOT_OWNER` for the ListBuckets / ListObjectVersions owner blocks.
 */
export const ROOT_OWNER = { ID: 'openbucket-root', DisplayName: 'openbucket' } as const;

/**
 * Parse a `<Tagging><TagSet><Tag><Key/><Value/></Tag>…</TagSet></Tagging>` body
 * (already XML-parsed onto `req.xmlBody` by the XmlInterceptor) into a flat
 * TagSet. `Tag` is array-hinted by the parser; an empty/absent TagSet yields `{}`.
 */
export function parseTagSet(xmlBody: unknown): TagSet {
  const tagSet = (xmlBody as { Tagging?: { TagSet?: unknown } } | undefined)?.Tagging?.TagSet;
  const tags =
    (tagSet && typeof tagSet === 'object'
      ? (tagSet as { Tag?: Array<{ Key?: unknown; Value?: unknown }> }).Tag
      : undefined) ?? [];
  const out: TagSet = {};
  for (const t of tags) {
    const key = t.Key === undefined || t.Key === null ? '' : String(t.Key);
    if (key.length === 0) continue;
    out[key] = t.Value === undefined || t.Value === null ? '' : String(t.Value);
  }
  return out;
}

/**
 * Build the `<Tagging>` response POJO for the XmlInterceptor. An empty tag set
 * serializes to `<TagSet></TagSet>` — GetObjectTagging returns this (200), while
 * GetBucketTagging throws `NoSuchTagSet` upstream before reaching here.
 */
export function taggingDoc(tags: TagSet | undefined): unknown {
  const entries = Object.entries(tags ?? {});
  return {
    __root: 'Tagging',
    TagSet: entries.length > 0 ? { Tag: entries.map(([Key, Value]) => ({ Key, Value })) } : {},
  };
}

type CorsMethod = CorsRule['allowedMethods'][number];

/**
 * Parse a `<CORSConfiguration><CORSRule>…</CORSRule></CORSConfiguration>` body
 * (already on `req.xmlBody`) into `CorsRule[]`. CORSRule / AllowedOrigin /
 * AllowedMethod / AllowedHeader / ExposeHeader are array-hinted by the parser,
 * so each is always an array; `ID` / `MaxAgeSeconds` are scalars.
 */
export function parseCorsConfig(xmlBody: unknown): CorsRule[] {
  const rules =
    (xmlBody as { CORSConfiguration?: { CORSRule?: unknown[] } } | undefined)?.CORSConfiguration
      ?.CORSRule ?? [];
  const out: CorsRule[] = [];
  for (const r of rules as Array<Record<string, unknown>>) {
    const rule: CorsRule = {
      allowedOrigins: asStringArray(r.AllowedOrigin),
      allowedMethods: asStringArray(r.AllowedMethod) as CorsMethod[],
    };
    if (r.ID !== undefined && r.ID !== null) rule.id = String(r.ID);
    const headers = asStringArray(r.AllowedHeader);
    if (headers.length > 0) rule.allowedHeaders = headers;
    const expose = asStringArray(r.ExposeHeader);
    if (expose.length > 0) rule.exposeHeaders = expose;
    if (r.MaxAgeSeconds !== undefined && r.MaxAgeSeconds !== null) {
      const n = Number(r.MaxAgeSeconds);
      if (Number.isFinite(n)) rule.maxAgeSeconds = n;
    }
    out.push(rule);
  }
  return out;
}

/** Build the `<CORSConfiguration>` response POJO for the XmlInterceptor. */
export function corsConfigDoc(rules: CorsRule[]): unknown {
  return {
    __root: 'CORSConfiguration',
    CORSRule: rules.map((r) => ({
      ...(r.id ? { ID: r.id } : {}),
      AllowedOrigin: r.allowedOrigins,
      AllowedMethod: r.allowedMethods,
      ...(r.allowedHeaders && r.allowedHeaders.length > 0
        ? { AllowedHeader: r.allowedHeaders }
        : {}),
      ...(r.exposeHeaders && r.exposeHeaders.length > 0 ? { ExposeHeader: r.exposeHeaders } : {}),
      ...(r.maxAgeSeconds !== undefined ? { MaxAgeSeconds: r.maxAgeSeconds } : {}),
    })),
  };
}

/** Coerce a parsed XML element (array | scalar | undefined) to `string[]`. */
function asStringArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x) => x !== undefined && x !== null && x !== '').map((x) => String(x));
}

/**
 * Parse a `<LifecycleConfiguration><Rule>…</Rule></LifecycleConfiguration>` body
 * (already on `req.xmlBody`) into `LifecycleRule[]`. `Rule` is array-hinted by the
 * parser, so it is always an array. OpenBucket has a single storage tier, so
 * `<Transition>` / `<NoncurrentVersionTransition>` (storage-class moves) are
 * accepted and ignored — only the expiration-style actions the background sweep
 * understands are retained.
 */
export function parseLifecycleConfig(xmlBody: unknown): LifecycleRule[] {
  const rules =
    (xmlBody as { LifecycleConfiguration?: { Rule?: unknown[] } } | undefined)
      ?.LifecycleConfiguration?.Rule ?? [];
  const out: LifecycleRule[] = [];
  for (const r of rules as Array<Record<string, unknown>>) {
    const rule: LifecycleRule = {
      id: r.ID === undefined || r.ID === null ? '' : String(r.ID),
      status: String(r.Status) === 'Disabled' ? 'Disabled' : 'Enabled',
    };
    // A prefix may sit on the rule (legacy) or inside <Filter> (modern, incl. <And>).
    const f = flattenLifecycleFilter(r.Filter);
    const prefix = r.Prefix ?? f.prefix;
    if (prefix !== undefined && prefix !== null) rule.prefix = String(prefix);
    if (f.filter) rule.filter = f.filter;

    const exp = r.Expiration as Record<string, unknown> | undefined;
    if (exp) {
      const days = toInt(exp.Days);
      if (days !== undefined) rule.expirationDays = days;
      if (exp.ExpiredObjectDeleteMarker !== undefined)
        rule.expiredObjectDeleteMarker = exp.ExpiredObjectDeleteMarker === true;
    }
    const ncDays = toInt(
      (r.NoncurrentVersionExpiration as Record<string, unknown> | undefined)?.NoncurrentDays,
    );
    if (ncDays !== undefined) rule.noncurrentVersionExpirationDays = ncDays;
    const abortDays = toInt(
      (r.AbortIncompleteMultipartUpload as Record<string, unknown> | undefined)
        ?.DaysAfterInitiation,
    );
    if (abortDays !== undefined) rule.abortIncompleteMultipartUploadDays = abortDays;
    out.push(rule);
  }
  return out;
}

/** Build the `<LifecycleConfiguration>` response POJO for the XmlInterceptor.
 *  Prefix/Tag/size predicates are emitted inside a (modern) `<Filter>`; a rule
 *  with no predicate still gets an empty `<Filter/>` (AWS requires Filter xor
 *  the legacy top-level Prefix). */
export function lifecycleConfigDoc(rules: LifecycleRule[]): unknown {
  return {
    __root: 'LifecycleConfiguration',
    Rule: rules.map((r) => {
      const rule: Record<string, unknown> = {
        ID: r.id,
        Status: r.status,
        Filter: lifecycleFilterDoc(r),
      };
      const expiration: Record<string, unknown> = {};
      if (r.expirationDays !== undefined) expiration.Days = r.expirationDays;
      if (r.expiredObjectDeleteMarker !== undefined)
        expiration.ExpiredObjectDeleteMarker = r.expiredObjectDeleteMarker;
      if (Object.keys(expiration).length > 0) rule.Expiration = expiration;
      if (r.noncurrentVersionExpirationDays !== undefined)
        rule.NoncurrentVersionExpiration = { NoncurrentDays: r.noncurrentVersionExpirationDays };
      if (r.abortIncompleteMultipartUploadDays !== undefined)
        rule.AbortIncompleteMultipartUpload = {
          DaysAfterInitiation: r.abortIncompleteMultipartUploadDays,
        };
      return rule;
    }),
  };
}

/** Merge a parsed `<Filter>` (optionally wrapped in `<And>`) into a prefix plus
 *  the model's filter predicates. `Tag` is array-hinted, so the first is used. */
function flattenLifecycleFilter(filterEl: unknown): {
  prefix?: string;
  filter?: LifecycleRule['filter'];
} {
  const filter = filterEl as Record<string, unknown> | undefined;
  if (!filter) return {};
  const and = filter.And as Record<string, unknown> | undefined;
  const src = and ?? filter;
  const out: { prefix?: string; filter?: LifecycleRule['filter'] } = {};
  if (src.Prefix !== undefined && src.Prefix !== null) out.prefix = String(src.Prefix);
  const model: NonNullable<LifecycleRule['filter']> = {};
  const tagRaw = src.Tag;
  const tag = (Array.isArray(tagRaw) ? tagRaw[0] : tagRaw) as
    | { Key?: unknown; Value?: unknown }
    | undefined;
  if (tag && tag.Key !== undefined && tag.Key !== null) {
    model.tag = { key: String(tag.Key), value: tag.Value == null ? '' : String(tag.Value) };
  }
  const gt = toInt(src.ObjectSizeGreaterThan);
  if (gt !== undefined) model.sizeGreaterThan = gt;
  const lt = toInt(src.ObjectSizeLessThan);
  if (lt !== undefined) model.sizeLessThan = lt;
  if (Object.keys(model).length > 0) out.filter = model;
  return out;
}

/** `<Filter>` body for a rule: prefix + tag + size predicates, wrapped in `<And>`
 *  when more than one predicate is present (AWS schema); empty `{}` when none. */
function lifecycleFilterDoc(r: LifecycleRule): Record<string, unknown> {
  const preds: Record<string, unknown> = {};
  if (r.prefix !== undefined) preds.Prefix = r.prefix;
  if (r.filter?.tag) preds.Tag = { Key: r.filter.tag.key, Value: r.filter.tag.value };
  if (r.filter?.sizeGreaterThan !== undefined)
    preds.ObjectSizeGreaterThan = r.filter.sizeGreaterThan;
  if (r.filter?.sizeLessThan !== undefined) preds.ObjectSizeLessThan = r.filter.sizeLessThan;
  const count = Object.keys(preds).length;
  if (count <= 1) return preds; // {} or a single predicate, unwrapped
  return { And: preds };
}

/** Coerce a parsed XML scalar (number | numeric string | …) to an integer, or undefined. */
function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

// -------- Object Lock (§2.8.2 bucket config, §2.8.3 object retention/hold) -----

/**
 * Parse a `<ObjectLockConfiguration>` body (already on `req.xmlBody`) into the
 * bucket's `ObjectLockBucketConfig`. `ObjectLockEnabled` must be `Enabled`; an
 * optional `<Rule><DefaultRetention>` carries the default mode + duration
 * (`Days`, or `Years` ×365). Throws `MalformedXML` on a missing/invalid root.
 */
export function parseObjectLockConfig(xmlBody: unknown): ObjectLockBucketConfig {
  const cfg = (xmlBody as { ObjectLockConfiguration?: Record<string, unknown> } | undefined)
    ?.ObjectLockConfiguration;
  if (!cfg) throw new MalformedXMLError('expected <ObjectLockConfiguration>');
  if (String(cfg.ObjectLockEnabled) !== 'Enabled') {
    throw new MalformedXMLError('ObjectLockEnabled must be Enabled');
  }
  const out: ObjectLockBucketConfig = { enabled: true };
  // `Rule` is array-hinted by the XmlParser (shared with lifecycle), so unwrap it.
  const ruleRaw = cfg.Rule;
  const rule = (Array.isArray(ruleRaw) ? ruleRaw[0] : ruleRaw) as
    | { DefaultRetention?: Record<string, unknown> }
    | undefined;
  const dr = rule?.DefaultRetention;
  if (dr) {
    const mode = xmlToLockMode(dr.Mode);
    if (mode) out.mode = mode;
    const days = toInt(dr.Days);
    const years = toInt(dr.Years);
    if (days !== undefined) out.defaultRetentionDays = days;
    else if (years !== undefined) out.defaultRetentionDays = years * 365;
  }
  return out;
}

/** Build the `<ObjectLockConfiguration>` response POJO for the XmlInterceptor. */
export function objectLockConfigDoc(cfg: ObjectLockBucketConfig): unknown {
  const doc: Record<string, unknown> = {
    __root: 'ObjectLockConfiguration',
    ObjectLockEnabled: 'Enabled',
  };
  if (cfg.mode || cfg.defaultRetentionDays !== undefined) {
    const dr: Record<string, unknown> = {};
    if (cfg.mode) dr.Mode = lockModeToXml(cfg.mode);
    if (cfg.defaultRetentionDays !== undefined) dr.Days = cfg.defaultRetentionDays;
    doc.Rule = { DefaultRetention: dr };
  }
  return doc;
}

/** Parse a `<Retention><Mode>…</Mode><RetainUntilDate>…</RetainUntilDate></Retention>`
 *  body into mode + ISO date. Throws `MalformedXML` on a missing/invalid field. */
export function parseRetention(xmlBody: unknown): { mode: ObjectLockMode; retainUntil: string } {
  const ret = (xmlBody as { Retention?: Record<string, unknown> } | undefined)?.Retention;
  if (!ret) throw new MalformedXMLError('expected <Retention>');
  const mode = xmlToLockMode(ret.Mode);
  if (!mode) throw new MalformedXMLError('invalid or missing Retention Mode');
  const until = ret.RetainUntilDate;
  if (until === undefined || until === null || String(until).length === 0) {
    throw new MalformedXMLError('missing RetainUntilDate');
  }
  return { mode, retainUntil: String(until) };
}

/** Build the `<Retention>` response POJO for the object-GET sub-resource path. */
export function retentionDoc(lock: ObjectLockObjectState): unknown {
  return {
    __root: 'Retention',
    Mode: lockModeToXml(lock.mode),
    RetainUntilDate: lock.retainUntil,
  };
}

/** Parse a `<LegalHold><Status>ON|OFF</Status></LegalHold>` body into a boolean.
 *  Throws `MalformedXML` when Status is neither ON nor OFF. */
export function parseLegalHold(xmlBody: unknown): boolean {
  const status = String(
    (xmlBody as { LegalHold?: { Status?: unknown } } | undefined)?.LegalHold?.Status ?? '',
  );
  if (status === 'ON') return true;
  if (status === 'OFF') return false;
  throw new MalformedXMLError('LegalHold Status must be ON or OFF');
}

/** Build the `<LegalHold>` response POJO. */
export function legalHoldDoc(on: boolean): unknown {
  return { __root: 'LegalHold', Status: on ? 'ON' : 'OFF' };
}

/** S3 lock Mode token (`GOVERNANCE` | `COMPLIANCE`) → stored enum, or undefined. */
function xmlToLockMode(v: unknown): ObjectLockMode | undefined {
  const s = String(v ?? '');
  if (s === 'GOVERNANCE') return ObjectLockMode.Governance;
  if (s === 'COMPLIANCE') return ObjectLockMode.Compliance;
  return undefined;
}

/** Stored enum → S3 lock Mode token. Only the two WORM modes are ever serialized. */
function lockModeToXml(m: ObjectLockMode): string {
  return m === ObjectLockMode.Compliance ? 'COMPLIANCE' : 'GOVERNANCE';
}

// -------- Server-side encryption (§2.8.2) -----------------------------

/**
 * Extract the default `SSEAlgorithm` from a `<ServerSideEncryptionConfiguration>`
 * body (already on `req.xmlBody`). `Rule` is array-hinted by the parser, so it is
 * unwrapped. Returns undefined when the document/algorithm is absent; the caller
 * (BucketService) enforces the v1 SSE-S3-only policy.
 */
export function parseEncryptionAlgorithm(xmlBody: unknown): string | undefined {
  const cfg = (
    xmlBody as { ServerSideEncryptionConfiguration?: { Rule?: unknown } } | undefined
  )?.ServerSideEncryptionConfiguration;
  if (!cfg) return undefined;
  const ruleRaw = cfg.Rule;
  const rule = (Array.isArray(ruleRaw) ? ruleRaw[0] : ruleRaw) as
    | { ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: unknown } }
    | undefined;
  const algo = rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
  return algo === undefined || algo === null ? undefined : String(algo);
}

/** Build the `<ServerSideEncryptionConfiguration>` response POJO. */
export function encryptionConfigDoc(cfg: EncryptionConfig): unknown {
  return {
    __root: 'ServerSideEncryptionConfiguration',
    Rule: {
      ApplyServerSideEncryptionByDefault: {
        SSEAlgorithm: cfg.algorithm,
        ...(cfg.kmsKeyId ? { KMSMasterKeyID: cfg.kmsKeyId } : {}),
      },
    },
  };
}

/**
 * Owner-full `<AccessControlPolicy>` — the single-tenant ACL returned by every
 * GetBucketAcl / GetObjectAcl (§2.8.2, §2.8.3). One grant: FULL_CONTROL to the
 * canonical owner. The `xsi:type` attribute on `<Grantee>` is what AWS clients
 * read as the grantee Type.
 */
export function ownerFullAclDoc(): unknown {
  return {
    __root: 'AccessControlPolicy',
    Owner: { ID: ROOT_OWNER.ID, DisplayName: ROOT_OWNER.DisplayName },
    AccessControlList: {
      Grant: {
        Grantee: {
          '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
          '@_xsi:type': 'CanonicalUser',
          ID: ROOT_OWNER.ID,
          DisplayName: ROOT_OWNER.DisplayName,
        },
        Permission: 'FULL_CONTROL',
      },
    },
  };
}
