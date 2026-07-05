import { Logger } from '@nestjs/common';
import { z } from 'zod';

import type { PolicyDocument } from '../../persistence/entities/types';

/**
 * Scoped-key authoring schema + prefix→policy compiler (EPIC-11, TASK-3000).
 *
 * A key scope is compiled once, at mint time, into the SAME `PolicyDocument`
 * grammar the EPIC-08 evaluator already understands, then enforced on the S3
 * hot path via a second `evaluatePolicy` pass with implicit-deny (TASK-3002).
 * Root credentials are loaded from env and never persisted, so they can never
 * carry a scope — scoping is strictly additive/opt-in.
 */

const log = new Logger('KeyScope');

/** S3 bucket-name syntax (mirrors `CreateBucketSchema` / `S3_BUCKET_RE`). */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** Max authored prefix length — bounds the compiled ARN + regex (DoS). */
export const MAX_PREFIX_LENGTH = 1024;

/** Max serialized compiled scope size — the evaluator is O(statements×resources). */
export const MAX_SCOPE_BYTES = 8 * 1024;

/** The default read+write object action set granted by a bare prefix scope. */
export const DEFAULT_SCOPE_ACTIONS = [
  's3:GetObject',
  's3:PutObject',
  's3:DeleteObject',
  's3:ListBucket',
] as const;

const OBJECT_ACTIONS = ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'];

// ---- PolicyDocument zod schema (guards parse of the stored blob) ----------

const StatementSchema = z.object({
  Sid: z.string().optional(),
  Effect: z.enum(['Allow', 'Deny']),
  Principal: z.union([
    z.literal('*'),
    z.object({ AWS: z.union([z.string(), z.array(z.string())]) }),
  ]),
  Action: z.union([z.string(), z.array(z.string())]),
  Resource: z.union([z.string(), z.array(z.string())]),
  Condition: z
    .record(z.string(), z.record(z.string(), z.union([z.string(), z.array(z.string())])))
    .optional(),
});

export const PolicyDocumentSchema = z.object({
  Version: z.literal('2012-10-17'),
  Statement: z.array(StatementSchema),
});

// ---- KeyScope authoring schema --------------------------------------------

const prefixField = z
  .string()
  .max(MAX_PREFIX_LENGTH, `prefix must be at most ${MAX_PREFIX_LENGTH} characters`)
  .refine((p) => !p.startsWith('/'), 'prefix must not start with "/"')
  .refine((p) => !p.split('/').includes('..'), 'prefix must not contain a ".." segment');

const actionField = z
  .array(z.string().regex(/^s3:[A-Za-z]+$/, 'action must be an s3:* IAM action'))
  .min(1)
  .max(32);

export const KeyScope = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prefix'),
    bucket: z.string().regex(BUCKET_NAME, 'bucket name must match S3 naming rules'),
    prefix: prefixField.optional(),
    actions: actionField.optional(),
  }),
  z
    .object({
      kind: z.literal('policy'),
      document: PolicyDocumentSchema,
    })
    .refine(
      (s) => Buffer.byteLength(JSON.stringify(s.document), 'utf8') <= MAX_SCOPE_BYTES,
      `inline policy must serialize to at most ${MAX_SCOPE_BYTES} bytes`,
    ),
]);

export type KeyScope = z.infer<typeof KeyScope>;

// ---- Compiler --------------------------------------------------------------

/**
 * Private-use sentinel substituted for evaluator glob metacharacters (`*`/`?`)
 * in a literal prefix. It is not a regex/glob metacharacter and never appears in
 * a real S3 key, so it stays a literal in the compiled pattern.
 */
const GLOB_SENTINEL = '\uE000';

/**
 * Neutralise evaluator glob metacharacters (`*`, `?`) in a literal prefix.
 *
 * The evaluator's glob has no literal-escape for `*`/`?`, so a tenant prefix
 * that literally contains one cannot be matched literally. Mapping each to a
 * private-use sentinel makes the compiled pattern match a strict subset — it
 * fails CLOSED for keys with a real `*`/`?` rather than letting the
 * metacharacter WIDEN (or slide sideways into another tenant's) grant. `*` in an
 * S3 key is unusual; this trades an edge-case key name for a hard no-broaden
 * guarantee.
 */
function escapeGlobLiteral(s: string): string {
  return s.replace(/[*?]/g, GLOB_SENTINEL);
}

/**
 * Compile a `KeyScope` into the evaluator's `PolicyDocument` grammar.
 *
 * The prefix form emits two `Allow` statements (`Principal: '*'` — the
 * principal is already pinned by the SigV4-resolved key, TASK-3002):
 *  - an object statement on `arn:aws:s3:::<bucket>/<prefix>*` for the object
 *    actions (Get/Put/Delete, intersected with `actions`);
 *  - a bucket statement on `arn:aws:s3:::<bucket>` for `s3:ListBucket`, gated by
 *    `StringLike s3:prefix` so an unprefixed `ListObjects` can't enumerate the
 *    whole bucket (the operator TASK-3004 teaches the evaluator).
 */
export function compileScopeToPolicy(scope: KeyScope): PolicyDocument {
  if (scope.kind === 'policy') return scope.document as PolicyDocument;

  const actions = scope.actions ?? [...DEFAULT_SCOPE_ACTIONS];
  const objectActions = OBJECT_ACTIONS.filter((a) => actions.includes(a));
  const listBucket = actions.includes('s3:ListBucket');

  const safePrefix = escapeGlobLiteral(scope.prefix ?? '');
  const statements: PolicyDocument['Statement'] = [];

  if (objectActions.length > 0) {
    statements.push({
      Sid: 'ScopeObjects',
      Effect: 'Allow',
      Principal: '*',
      Action: objectActions,
      Resource: `arn:aws:s3:::${scope.bucket}/${safePrefix}*`,
    });
  }

  if (listBucket) {
    statements.push({
      Sid: 'ScopeList',
      Effect: 'Allow',
      Principal: '*',
      Action: 's3:ListBucket',
      Resource: `arn:aws:s3:::${scope.bucket}`,
      Condition: { StringLike: { 's3:prefix': [`${safePrefix}*`, safePrefix] } },
    });
  }

  return { Version: '2012-10-17', Statement: statements };
}

/** A deny-everything document — an empty statement list denies under implicit-deny. */
export const DENY_ALL_SCOPE: PolicyDocument = { Version: '2012-10-17', Statement: [] };

/**
 * Parse a stored `scopePolicy` row value into a `PolicyDocument`.
 *  - `null`/`undefined` (unscoped key) → `null` (no scope check applies);
 *  - malformed JSON or a document that fails the schema → `DENY_ALL_SCOPE`
 *    (fail closed — a corrupt scope must never open access).
 */
export function parseScopePolicy(raw: string | null | undefined): PolicyDocument | null {
  if (raw == null) return null;
  try {
    return PolicyDocumentSchema.parse(JSON.parse(raw)) as PolicyDocument;
  } catch {
    log.error('failed to parse stored scopePolicy — failing closed (deny-all)');
    return DENY_ALL_SCOPE;
  }
}

/** Serialize a compiled scope for persistence, enforcing the size cap. */
export function serializeScope(doc: PolicyDocument): string {
  const json = JSON.stringify(doc);
  if (Buffer.byteLength(json, 'utf8') > MAX_SCOPE_BYTES) {
    throw new Error(`compiled scope exceeds ${MAX_SCOPE_BYTES} bytes`);
  }
  return json;
}

/** Compact, secret-free summary of a stored scope for the admin API. */
export interface KeyScopeView {
  kind: 'prefix' | 'policy';
  bucket?: string;
  prefix?: string;
}

/**
 * Render a `KeyScopeView` from a stored scope: the authored `bucket`/`prefix`
 * reconstructed from the first object Resource ARN, or `{ kind: 'policy' }`
 * when the shape isn't a plain prefix compile. Never leaks the secret.
 */
export function summarizeScope(raw: string | null | undefined): KeyScopeView | null {
  if (raw == null) return null;
  const doc = parseScopePolicy(raw);
  if (!doc || doc.Statement.length === 0) return { kind: 'policy' };
  const objectStmt = doc.Statement.find((s) => s.Sid === 'ScopeObjects') ?? doc.Statement[0];
  const resource = Array.isArray(objectStmt.Resource) ? objectStmt.Resource[0] : objectStmt.Resource;
  const m = /^arn:aws:s3:::([^/]+)\/(.*)\*$/.exec(resource ?? '');
  if (!m) return { kind: 'policy' };
  // Best-effort un-escape of the glob sentinel for display only.
  const prefix = m[2].split(GLOB_SENTINEL).join('*');
  return { kind: 'prefix', bucket: m[1], prefix };
}
