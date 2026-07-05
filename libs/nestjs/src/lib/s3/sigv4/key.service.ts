/**
 * KeyService — the SigV4 persistence boundary (WHITEPAPER §2.4.2).
 *
 * The SigV4 guard never touches MikroORM; it depends on this abstract token
 * only. The concrete implementation (backed by the env root key + the
 * `access_keys` table) lives in the persistence layer and is adapted onto this
 * token in `S3Module`.
 */
export interface AccessKey {
  accessKeyId: string;
  secretAccessKey: string;
  disabled: boolean;
  /** True when this is the env root key, not a stored sub-key (EPIC-11). */
  isRoot: boolean;
  /** Compiled scope `PolicyDocument` (JSON text) for a scoped sub-key, else null. */
  scopePolicy: string | null;
}

export abstract class KeyService {
  /**
   * Resolve an access key id to its secret.
   *
   * Contract:
   *  - Returns null if the access key id is unknown OR is disabled.
   *  - MUST be constant-time across all known/unknown branches at the
   *    *caller's* level — i.e., it is acceptable for this method to return
   *    quickly with null; the SigV4Guard wraps the comparison in
   *    timingSafeEqual to prevent timing leakage of the secret itself.
   *  - The implementation MAY cache results in memory for up to 60 s.
   *  - Implementation belongs to the persistence agent (see §4).
   */
  abstract getSecret(accessKeyId: string): Promise<AccessKey | null>;
}
