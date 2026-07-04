import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { BucketService } from '../../domain/buckets/bucket.service';
import { AccessDeniedError } from '../errors/s3-error';
import { operationToAction } from './operation-action';
import { evaluatePolicy } from './policy-evaluator';

/**
 * PolicyAuthorizationGuard (TASK-2120, finding [11], CWE-862).
 *
 * Runs immediately after {@link SigV4Guard} in the controller `@UseGuards`
 * chain — so `req.openbucket.accessKeyId`, `.bucket`, `.key` and `.operation`
 * are already populated — and enforces the stored bucket policy that was
 * previously stored/echoed but never evaluated. Resolves the request's IAM
 * action + resource ARN, evaluates the policy with explicit-Deny-overrides, and
 * throws {@link AccessDeniedError} (403) on an explicit deny / unmet condition.
 *
 * No-ops (allow) when the request has no bucket (service scope, e.g.
 * ListBuckets), the bucket has no policy (single-root default-allow), or the
 * operation is unknown — the SigV4 credential check already authorised it.
 */
@Injectable()
export class PolicyAuthorizationGuard implements CanActivate {
  constructor(private readonly buckets: BucketService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.openbucket?.kind !== 's3') return true;

    const bucket = req.openbucket.bucket;
    if (!bucket) return true; // service-scope op — no bucket policy applies

    const policy = await this.buckets.tryGetPolicyDoc(bucket);
    if (!policy) return true; // no policy (or bucket absent) → single-root default-allow

    const action = operationToAction(req.openbucket.operation);
    if (!action) return true; // unrecognised op — leave it to the SigV4 credential check

    const key = req.openbucket.key;
    const resource = key ? `arn:aws:s3:::${bucket}/${key}` : `arn:aws:s3:::${bucket}`;

    const decision = evaluatePolicy(
      policy,
      {
        action,
        resource,
        principal: req.openbucket.accessKeyId ?? '*',
        // `req.secure` already respects the app's `trust proxy 'loopback'`
        // setting (X-Forwarded-Proto only honoured from a trusted proxy).
        secureTransport: req.secure === true,
        sourceIp: req.ip ?? '',
      },
      // Single-root credential: preserve pre-policy behaviour — only an explicit
      // Deny (a compensating control) blocks; a policy with no matching Allow
      // does not lock the root principal out.
      { defaultAllow: true },
    );

    if (decision === 'deny') {
      throw new AccessDeniedError('Access Denied by bucket policy');
    }
    return true;
  }
}
