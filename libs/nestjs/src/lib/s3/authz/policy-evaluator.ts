import type { PolicyDocument } from '../../persistence/entities/types';

/**
 * Bucket-policy evaluator (TASK-2120, finding [11], CWE-862).
 *
 * A pure function — no Nest/request deps — so it can be unit-tested in
 * isolation and reused by the `PolicyAuthorizationGuard`. It implements the
 * subset of the IAM policy grammar the storage layer already accepts
 * (`PolicyDocument`): Action/Resource/Principal glob matching plus the two
 * advertised Condition operators (`Bool aws:SecureTransport`,
 * `IpAddress`/`NotIpAddress` aws:SourceIp), with **explicit-Deny-overrides**.
 */
export interface PolicyEvaluationContext {
  /** Resolved IAM action, e.g. `s3:GetObject`. */
  action: string;
  /** Resolved resource ARN, e.g. `arn:aws:s3:::bucket/key` or `arn:aws:s3:::bucket`. */
  resource: string;
  /** Resolved request principal (access-key id), or `*` for an anonymous request. */
  principal: string;
  /** Whether the request arrived over TLS (drives `aws:SecureTransport`). */
  secureTransport: boolean;
  /** Client source IP (drives `aws:SourceIp`). */
  sourceIp: string;
  /**
   * S3 request key prefix (from `?prefix=` on a ListObjects/V2/Versions call),
   * drives `StringLike`/`StringNotLike` `s3:prefix` (TASK-3004). Defaults to `''`
   * when absent, so an unprefixed listing does not satisfy a prefix-gated Allow.
   */
  prefix?: string;
}

export type PolicyDecision = 'allow' | 'deny';

type Statement = PolicyDocument['Statement'][number];

/**
 * Evaluate `policy` for `ctx`. Semantics (AWS-aligned):
 *  - any matching `Deny` statement → `deny` (explicit deny overrides);
 *  - else any matching `Allow` statement → `allow`;
 *  - else the `defaultAllow` fallback (default `false` = implicit deny).
 *
 * The guard evaluates the single-root credential with `defaultAllow: true` so a
 * policy without a matching statement preserves the pre-policy behaviour and
 * only an explicit `Deny` (a compensating network/TLS/action-scoped control)
 * can block it.
 */
export function evaluatePolicy(
  policy: PolicyDocument | null | undefined,
  ctx: PolicyEvaluationContext,
  opts: { defaultAllow?: boolean } = {},
): PolicyDecision {
  const statements = Array.isArray(policy?.Statement) ? (policy as PolicyDocument).Statement : [];
  let explicitAllow = false;

  for (const stmt of statements) {
    if (!statementMatches(stmt, ctx)) continue;
    // Explicit Deny wins regardless of statement order or a matching Allow.
    if (stmt.Effect === 'Deny') return 'deny';
    if (stmt.Effect === 'Allow') explicitAllow = true;
  }

  if (explicitAllow) return 'allow';
  return opts.defaultAllow ? 'allow' : 'deny';
}

function statementMatches(stmt: Statement, ctx: PolicyEvaluationContext): boolean {
  return (
    principalMatches(stmt.Principal, ctx.principal) &&
    anyGlobMatches(stmt.Action, ctx.action) &&
    anyGlobMatches(stmt.Resource, ctx.resource) &&
    conditionsMatch(stmt.Condition, ctx, stmt.Effect)
  );
}

function principalMatches(principal: Statement['Principal'], subject: string): boolean {
  if (principal === '*') return true;
  if (principal && typeof principal === 'object') {
    const aws = principal.AWS;
    const list = Array.isArray(aws) ? aws : [aws];
    return list.some((p) => p === '*' || p === subject);
  }
  return false;
}

/** True when any glob in `patterns` matches `value`. */
function anyGlobMatches(patterns: string | string[] | undefined, value: string): boolean {
  const list = patterns === undefined ? [] : Array.isArray(patterns) ? patterns : [patterns];
  return list.some((p) => globMatches(p, value));
}

/** IAM-style glob: `*` = any run, `?` = one char. Anchored full match. */
function globMatches(pattern: string, value: string): boolean {
  const rx = new RegExp(
    '^' +
      pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') +
      '$',
  );
  return rx.test(value);
}

/**
 * Evaluate a statement's `Condition` block. Every operator/key must hold.
 * Unknown operators/keys **fail closed**: for a `Deny` they are treated as
 * satisfied (so the deny still applies); for an `Allow` they are treated as
 * unsatisfied (so the allow does not silently grant access).
 */
function conditionsMatch(
  condition: Statement['Condition'],
  ctx: PolicyEvaluationContext,
  effect: Statement['Effect'],
): boolean {
  if (!condition) return true;
  for (const [operator, keys] of Object.entries(condition)) {
    for (const [key, rawValues] of Object.entries(keys)) {
      const values = Array.isArray(rawValues) ? rawValues : [rawValues];
      const result = evalConditionOperator(operator, key, values, ctx);
      if (result === 'unknown') {
        if (effect === 'Deny') continue; // fail closed → keep the deny
        return false; // fail closed → do not grant the allow
      }
      if (!result) return false;
    }
  }
  return true;
}

function evalConditionOperator(
  operator: string,
  key: string,
  values: string[],
  ctx: PolicyEvaluationContext,
): boolean | 'unknown' {
  if (operator === 'Bool' && key === 'aws:SecureTransport') {
    const expected = String(values[0]).toLowerCase() === 'true';
    return ctx.secureTransport === expected;
  }
  if (operator === 'IpAddress' && key === 'aws:SourceIp') {
    return ipInAnyCidr(ctx.sourceIp, values);
  }
  if (operator === 'NotIpAddress' && key === 'aws:SourceIp') {
    return !ipInAnyCidr(ctx.sourceIp, values);
  }
  // s3:prefix glob (TASK-3004) — gates a prefix-scoped key's ListBucket grant so
  // an unprefixed / mismatched listing can't enumerate the whole bucket. Reuses
  // the same anchored IAM glob (`*`/`?`) as Action/Resource matching.
  if (operator === 'StringLike' && key === 's3:prefix') {
    return anyGlobMatches(values, ctx.prefix ?? '');
  }
  if (operator === 'StringNotLike' && key === 's3:prefix') {
    return !anyGlobMatches(values, ctx.prefix ?? '');
  }
  return 'unknown';
}

// ---- IPv4 CIDR matching -------------------------------------------------

function ipInAnyCidr(ip: string, cidrs: string[]): boolean {
  const addr = ipv4ToInt(ip);
  if (addr === null) return false;
  return cidrs.some((cidr) => {
    const [net, prefixStr] = cidr.split('/');
    const netInt = ipv4ToInt(net);
    if (netInt === null) return false;
    const prefix = prefixStr === undefined ? 32 : Number.parseInt(prefixStr, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    return (addr & mask) >>> 0 === (netInt & mask) >>> 0;
  });
}

/** Parse a dotted-quad IPv4 (stripping any `::ffff:` v4-mapped prefix) to a uint32. */
function ipv4ToInt(ip: string): number | null {
  const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  const parts = v4.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}
