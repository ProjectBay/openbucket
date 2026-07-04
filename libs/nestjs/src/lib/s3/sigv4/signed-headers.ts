import type { IncomingHttpHeaders } from 'node:http';

import { AccessDeniedError } from '../errors/s3-error';

/**
 * Enforce AWS's mandatory-header rule on a parsed `SignedHeaders` list
 * (TASK-2121, finding [8], CWE-345). Single source of truth for both SigV4
 * paths (`SigV4Guard.checkHeader` and `verifyPresigned`).
 *
 * The `SignedHeaders` list is otherwise taken verbatim from the client and
 * folded into the canonical request, so a signer could leave `host` (or a
 * wire-present `x-amz-*` header) out of the signature and thus unbound. AWS
 * rejects such requests; we mirror that:
 *
 *  1. the lowercased list MUST contain `host`; and
 *  2. every request header actually present on the wire whose name starts with
 *     `x-amz-` MUST appear in the list.
 *
 * Violations throw {@link AccessDeniedError} (403). Every mainstream AWS
 * SDK/CLI already signs `host` and all `x-amz-*` headers, so compliant clients
 * are unaffected.
 */
export function assertMandatorySignedHeaders(
  signedHeaders: string[],
  headers: IncomingHttpHeaders,
): void {
  const signed = new Set(signedHeaders.map((h) => h.toLowerCase()));

  if (!signed.has('host')) {
    throw new AccessDeniedError("SignedHeaders must include 'host'");
  }

  for (const name of Object.keys(headers)) {
    if (headers[name] === undefined) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith('x-amz-') && !signed.has(lower)) {
      throw new AccessDeniedError(`SignedHeaders is missing required header '${lower}'`);
    }
  }
}
