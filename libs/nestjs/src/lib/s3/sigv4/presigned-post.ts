import * as crypto from 'node:crypto';

import {
  AccessDeniedError,
  EntityTooLargeError,
  EntityTooSmallError,
  MalformedPolicyError,
} from '../errors/s3-error';
import { awsUriEncode } from './canonical-request';
import { constantTimeEquals, deriveSigningKey } from './sigv4.verifier';

/**
 * POST-policy crypto core for S3 browser uploads (WHITEPAPER §2.5.1), symmetric
 * with the `buildPresignedUrl` / `verifyPresigned` pair in `presigned.ts`. Pure
 * crypto — no Nest / HTTP / MikroORM dependencies — so it is unit-testable in
 * isolation. It mints a base64 POST policy + SigV4 signature from a credential
 * and, on the serving side, parses the submitted policy, evaluates its
 * `conditions` against the submitted form fields, and re-derives + constant-time
 * compares the signature.
 */

/** A single S3 POST-policy condition (AWS-compatible forms). */
export type PostPolicyCondition =
  | Record<string, string> // exact match: { key: 'uploads/a.png' }
  | ['eq', string, string] // ['eq', '$key', 'uploads/a.png']
  | ['starts-with', string, string] // ['starts-with', '$key', 'uploads/']
  | ['content-length-range', number, number];

/** An S3 POST policy document. */
export interface PostPolicy {
  /** ISO-8601 expiry, e.g. `2026-07-02T12:00:00.000Z`. */
  expiration: string;
  conditions: PostPolicyCondition[];
}

/** Input for {@link buildPresignedPost} — mirrors `PresignInput` in presigned.ts. */
export interface PresignPostInput {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  scheme: string;
  host: string;
  bucket: string;
  /** Object key. May contain the literal `${filename}` placeholder. */
  key: string;
  expiresIn: number;
  now: Date;
  /** Route prefix the store is mounted under (e.g. `/storage`); `''` for root. */
  basePath?: string;
  /**
   * `starts-with` the key instead of an exact match (folder-scoped upload
   * tokens). Implied when `key` contains `${filename}`.
   */
  keyStartsWith?: boolean;
  /** Pin (`string`) or prefix-restrict (`{ startsWith }`) the `Content-Type`. */
  contentType?: string | { startsWith: string };
  successActionStatus?: '200' | '201' | '204';
  successActionRedirect?: string;
  /**
   * Extra raw conditions merged verbatim into the policy — e.g. the
   * `['content-length-range', min, max]` the facade always injects.
   */
  extraConditions?: PostPolicyCondition[];
}

/** The minted `{ url, fields }` an embedding app hands to a browser form. */
export interface PresignedPostResult {
  url: string;
  fields: Record<string, string>;
}

/** Cap the base64 `policy` decode so a hostile form can't exhaust the parser. */
const MAX_POLICY_B64_BYTES = 20 * 1024;

/**
 * Submitted form fields that never need to be covered by a policy condition
 * (the `file` part + the signature envelope + AWS-reserved auth params). Every
 * other submitted field must be named by at least one condition or the request
 * fails closed (mirrors S3's "Invalid according to Policy").
 */
const UNCOVERED_EXEMPT = new Set([
  'file',
  'policy',
  'x-amz-signature',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-security-token',
  'x-amz-signature-version',
]);

// ---- Minting ----------------------------------------------------------------

/**
 * Mint a base64 POST policy + SigV4 signature. Unlike the query presign (which
 * hashes a canonical request), the StringToSign for a POST is literally the
 * base64 policy: `signature = HMAC-SHA256(signingKey, policyB64)` hex.
 */
export function buildPresignedPost(p: PresignPostInput): PresignedPostResult {
  const amzDate = p.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const credentialScope = `${date}/${p.region}/s3/aws4_request`;
  const credential = `${p.accessKeyId}/${credentialScope}`;
  const expiration = new Date(p.now.getTime() + p.expiresIn * 1000).toISOString();

  const { condition: keyCondition, fieldValue: keyField } = buildKeyCondition(
    p.key,
    p.keyStartsWith === true,
  );

  const conditions: PostPolicyCondition[] = [
    { bucket: p.bucket },
    keyCondition,
    { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
    { 'x-amz-credential': credential },
    { 'x-amz-date': amzDate },
  ];
  const fields: Record<string, string> = {
    key: keyField,
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': credential,
    'x-amz-date': amzDate,
  };

  if (typeof p.contentType === 'string') {
    conditions.push({ 'Content-Type': p.contentType });
    fields['Content-Type'] = p.contentType;
  } else if (p.contentType) {
    // A prefix restriction has no fixed field value — the browser supplies its
    // own Content-Type within the allowed prefix.
    conditions.push(['starts-with', '$Content-Type', p.contentType.startsWith]);
  }

  if (p.successActionStatus) {
    conditions.push({ success_action_status: p.successActionStatus });
    fields['success_action_status'] = p.successActionStatus;
  }
  if (p.successActionRedirect) {
    conditions.push({ success_action_redirect: p.successActionRedirect });
    fields['success_action_redirect'] = p.successActionRedirect;
  }
  if (p.extraConditions?.length) conditions.push(...p.extraConditions);

  const policy: PostPolicy = { expiration, conditions };
  const policyB64 = Buffer.from(JSON.stringify(policy)).toString('base64');

  const signingKey = deriveSigningKey(p.secretAccessKey, credentialScope);
  const signature = crypto.createHmac('sha256', signingKey).update(policyB64).digest('hex');

  fields['policy'] = policyB64;
  fields['x-amz-signature'] = signature;

  // Normalise the mount prefix identically to buildPresignedUrl: leading slash,
  // no trailing slash, `''` for root.
  const prefix = p.basePath
    ? `/${p.basePath.replace(/^\/+/, '').replace(/\/+$/, '')}`.replace(/^\/$/, '')
    : '';
  const url = `${p.scheme}://${p.host}${prefix}/${awsUriEncode(p.bucket, false)}`;

  return { url, fields };
}

/**
 * Decide the `$key` condition: `starts-with` the prefix before `${filename}`
 * (S3 substitutes the placeholder server-side), `starts-with` the whole key when
 * the caller asked for a folder-scoped token, else an exact match.
 */
function buildKeyCondition(
  key: string,
  keyStartsWith: boolean,
): { condition: PostPolicyCondition; fieldValue: string } {
  const filenameIdx = key.indexOf('${filename}');
  if (filenameIdx !== -1) {
    return { condition: ['starts-with', '$key', key.slice(0, filenameIdx)], fieldValue: key };
  }
  if (keyStartsWith) {
    return { condition: ['starts-with', '$key', key], fieldValue: key };
  }
  return { condition: { key }, fieldValue: key };
}

// ---- Serving ----------------------------------------------------------------

/**
 * Base64-decode + `JSON.parse` a submitted policy. Throws {@link
 * MalformedPolicyError} on bad base64/JSON, a missing `expiration`/`conditions`,
 * or an over-large payload (the decode is capped at 20 KB before `JSON.parse` to
 * bound parser work — CWE-400).
 */
export function parsePostPolicy(policyB64: string): PostPolicy {
  if (typeof policyB64 !== 'string' || policyB64.length === 0) {
    throw new MalformedPolicyError();
  }
  if (policyB64.length > MAX_POLICY_B64_BYTES) {
    throw new MalformedPolicyError('The policy document is too large.');
  }
  const json = Buffer.from(policyB64, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MalformedPolicyError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MalformedPolicyError();
  }
  const pol = parsed as Partial<PostPolicy>;
  if (typeof pol.expiration !== 'string' || !Array.isArray(pol.conditions)) {
    throw new MalformedPolicyError();
  }
  return { expiration: pol.expiration, conditions: pol.conditions };
}

/**
 * Evaluate a parsed policy against the submitted form `fields`. Throws on the
 * first violation:
 *  - expired policy → `AccessDeniedError('Policy expired')`;
 *  - a failed exact/`eq`/`starts-with` condition → `AccessDeniedError`;
 *  - `content-length-range` violated → `EntityTooSmallError`/`EntityTooLargeError`
 *    (only when `streamedBytes` is provided — length is enforced on the wire);
 *  - any submitted field not covered by a condition (and not AWS-reserved) →
 *    `AccessDeniedError` (fail-closed, mirrors `conditionsMatch`).
 *
 * `bucket` is the route bucket, special-cased for the `bucket` condition (it is
 * not a browser-submitted field). Pass `streamedBytes = undefined` for the
 * up-front pass and enforce the length range on streamed bytes separately.
 */
export function evaluatePostPolicy(
  policy: PostPolicy,
  fields: Record<string, string>,
  bucket: string,
  streamedBytes?: number,
): void {
  const exp = Date.parse(policy.expiration);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    throw new AccessDeniedError('Policy expired');
  }

  const covered = new Set<string>();

  for (const cond of policy.conditions) {
    if (Array.isArray(cond)) {
      const op = cond[0];
      if (op === 'content-length-range') {
        const min = Number(cond[1]);
        const max = Number(cond[2]);
        if (typeof streamedBytes === 'number') {
          if (streamedBytes < min) throw new EntityTooSmallError();
          if (streamedBytes > max) throw new EntityTooLargeError(streamedBytes, max);
        }
        continue;
      }
      if (op === 'eq' || op === 'starts-with') {
        const name = String(cond[1]).replace(/^\$/, '');
        const expected = String(cond[2]);
        const actual = resolveField(fields, name, bucket);
        covered.add(name.toLowerCase());
        if (op === 'eq') {
          if (actual !== expected) throw invalidCondition(name);
        } else if (actual === undefined || !actual.startsWith(expected)) {
          throw invalidCondition(name);
        }
        continue;
      }
      throw new MalformedPolicyError('Invalid policy condition.');
    }

    if (cond && typeof cond === 'object') {
      const names = Object.keys(cond);
      if (names.length !== 1) throw new MalformedPolicyError('Invalid policy condition.');
      const name = names[0];
      const expected = String((cond as Record<string, string>)[name]);
      const actual = resolveField(fields, name, bucket);
      covered.add(name.toLowerCase());
      if (actual !== expected) throw invalidCondition(name);
      continue;
    }
    throw new MalformedPolicyError('Invalid policy condition.');
  }

  // Fail-closed: every submitted field (except `file`, the signature envelope,
  // and AWS-reserved auth params) must be covered by at least one condition.
  for (const name of Object.keys(fields)) {
    const lower = name.toLowerCase();
    if (UNCOVERED_EXEMPT.has(lower)) continue;
    if (!covered.has(lower)) {
      throw new AccessDeniedError(
        `Invalid according to Policy: Extra input fields: ${name}`,
      );
    }
  }
}

/** The `content-length-range` [min, max] from a policy, if it declares one. */
export function policyContentLengthRange(
  policy: PostPolicy,
): { min: number; max: number } | undefined {
  for (const cond of policy.conditions) {
    if (Array.isArray(cond) && cond[0] === 'content-length-range') {
      return { min: Number(cond[1]), max: Number(cond[2]) };
    }
  }
  return undefined;
}

/**
 * Recompute `HMAC(deriveSigningKey(secret, scope), policyB64)` and constant-time
 * compare it to the submitted `x-amz-signature`. Returns `false` (never throws)
 * on any mismatch — including a bad algorithm or credential scope — so the
 * caller emits a generic error without leaking whether the key exists (same
 * contract as `verifyPresigned`).
 */
export function verifyPostSignature(
  fields: Record<string, string>,
  secretAccessKey: string,
): boolean {
  const credential = fields['x-amz-credential'];
  const policyB64 = fields['policy'];
  const presented = fields['x-amz-signature'];
  const algorithm = fields['x-amz-algorithm'];
  if (!credential || !policyB64 || !presented) return false;
  if (algorithm !== 'AWS4-HMAC-SHA256') return false;
  const scope = scopeFromCredential(credential);
  if (!scope) return false;
  const signingKey = deriveSigningKey(secretAccessKey, scope);
  const expected = crypto.createHmac('sha256', signingKey).update(policyB64).digest('hex');
  return constantTimeEquals(expected, presented);
}

/** The access-key id from an `x-amz-credential` field, or `null` if malformed. */
export function accessKeyIdFromCredential(credential: string | undefined): string | null {
  if (!credential) return null;
  const parts = credential.split('/');
  return parts.length === 5 ? parts[0] : null;
}

/**
 * Validate + extract the credential scope (`date/region/s3/aws4_request`) from
 * an `x-amz-credential` field. Returns `null` on a malformed scope or a
 * non-`s3`/`aws4_request` terminator — verified exactly like `verifyPresigned`.
 */
export function scopeFromCredential(credential: string | undefined): string | null {
  if (!credential) return null;
  const parts = credential.split('/');
  if (parts.length !== 5) return null;
  const [, date, region, service, terminator] = parts;
  if (service !== 's3' || terminator !== 'aws4_request') return null;
  return `${date}/${region}/${service}/${terminator}`;
}

/** Resolve a condition's field name to its value (bucket is the route bucket). */
function resolveField(
  fields: Record<string, string>,
  name: string,
  bucket: string,
): string | undefined {
  if (name.toLowerCase() === 'bucket') return bucket;
  if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name];
  // S3 treats POST field names case-insensitively (e.g. `Content-Type`).
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(fields)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function invalidCondition(name: string): AccessDeniedError {
  return new AccessDeniedError(
    `Invalid according to Policy: Policy Condition failed: [${name}]`,
  );
}
