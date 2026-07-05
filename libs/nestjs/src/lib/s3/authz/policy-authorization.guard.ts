import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { BucketService } from '../../domain/buckets/bucket.service';
import { AccessDeniedError } from '../errors/s3-error';
import { isPostObjectForm } from '../routing/operation-resolver';
import { operationToAction } from './operation-action';
import { evaluatePolicy, type PolicyEvaluationContext } from './policy-evaluator';

/** Listing ops whose `?prefix=` gates a prefix-scoped key's ListBucket grant (TASK-3004). */
const LISTING_OPS = new Set(['ListObjects', 'ListObjectsV2', 'ListObjectVersions']);

/**
 * PolicyAuthorizationGuard (TASK-2120, finding [11], CWE-862; EPIC-11 scoping).
 *
 * Runs immediately after {@link SigV4Guard} in the controller `@UseGuards`
 * chain — so `req.openbucket.accessKeyId`, `.bucket`, `.key`, `.operation`,
 * `.isRoot` and `.keyScope` are already populated — and enforces two things:
 *
 *  1. the stored **bucket policy** (unchanged): root credentials keep
 *     `defaultAllow: true`, so only an explicit `Deny` blocks them;
 *  2. the resolved key's **scope** (EPIC-11, TASK-3002): a non-root scoped key
 *     is additionally run through the scope with `defaultAllow: false`
 *     (implicit-deny), so an action/resource the scope does not `Allow` is
 *     denied even when the bucket has no policy. The effective decision is
 *     `bucket-policy AND scope`; an explicit bucket `Deny` is checked first so
 *     it is never masked by the scope pass.
 *
 * Root path is byte-identical to pre-change: root is never scope-checked and a
 * request with no bucket / no policy / unknown op still allows.
 */
@Injectable()
export class PolicyAuthorizationGuard implements CanActivate {
  constructor(private readonly buckets: BucketService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.openbucket?.kind !== 's3') return true;

    // Browser POST-policy upload (STORY-0802): this guard runs before the body is
    // parsed, so `accessKeyId` (the principal) isn't known yet. Skip here and
    // evaluate the bucket policy inside `objects.postObject` once the credential
    // + key are resolved — identical `evaluatePolicy` semantics, no authz gap.
    if (isPostObjectForm(req)) return true;

    const isRoot = req.openbucket.isRoot === true;
    const keyScope = req.openbucket.keyScope ?? null;
    const scoped = !isRoot && keyScope != null;

    const bucket = req.openbucket.bucket;
    const action = operationToAction(req.openbucket.operation);
    const key = req.openbucket.key;
    const resource = bucket
      ? key
        ? `arn:aws:s3:::${bucket}/${key}`
        : `arn:aws:s3:::${bucket}`
      : '*'; // service-scope op (e.g. ListBuckets) has no bucket ARN

    const evalCtx: PolicyEvaluationContext = {
      action: action ?? '',
      resource,
      principal: req.openbucket.accessKeyId ?? '*',
      // `req.secure` already respects the app's `trust proxy 'loopback'` setting.
      secureTransport: req.secure === true,
      sourceIp: req.ip ?? '',
      // ListBucket-class ops: feed `?prefix=` so the scope's StringLike s3:prefix
      // condition gates enumeration (TASK-3004); inert for object ops.
      prefix: LISTING_OPS.has(req.openbucket.operation ?? '')
        ? ((req.query as Record<string, string | undefined>).prefix ?? '')
        : undefined,
    };

    // 1) Bucket policy — unchanged semantics. Only evaluated for a bucket-scoped
    //    op with a recognised action and a stored policy; root keeps default-allow.
    if (bucket && action) {
      const policy = await this.buckets.tryGetPolicyDoc(bucket);
      if (policy) {
        const decision = evaluatePolicy(policy, evalCtx, { defaultAllow: true });
        if (decision === 'deny') {
          throw new AccessDeniedError('Access Denied by bucket policy');
        }
      }
    }

    // 2) Key scope (EPIC-11) — non-root scoped keys only, implicit-deny. Runs even
    //    when the bucket has no policy or the request is service-scope, so a tenant
    //    key can't enumerate all buckets or reach outside its prefix. An op we
    //    can't map to an action fails closed for a scoped key.
    if (scoped) {
      if (!action) {
        throw new AccessDeniedError('Access Denied: out of key scope');
      }
      const scopeDecision = evaluatePolicy(keyScope, evalCtx, { defaultAllow: false });
      if (scopeDecision === 'deny') {
        throw new AccessDeniedError('Access Denied: out of key scope');
      }
    }

    return true;
  }
}
