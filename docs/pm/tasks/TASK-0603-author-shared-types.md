---
id: TASK-0603
title: Author shared types and enums module
story: STORY-0201
status: done
type: implementation
size: S
---

## Description
Create `libs/persistence/src/entities/types.ts` with every shared enum and interface consumed by the nine entities and downstream services.

## Files to create / modify
- `libs/persistence/src/entities/types.ts` — new

## Implementation notes
- Enums (verbatim string values per §3.2.1):
  - `enum VersioningState { Disabled = 'disabled', Enabled = 'enabled', Suspended = 'suspended' }`
  - `enum ObjectLockMode { Off = 'off', Governance = 'governance', Compliance = 'compliance' }`
  - `enum StorageClass { Standard = 'STANDARD', ReducedRedundancy = 'REDUCED_REDUNDANCY', StandardIA = 'STANDARD_IA', Glacier = 'GLACIER', DeepArchive = 'DEEP_ARCHIVE' }`
- Interfaces (verbatim shapes per §3.2.1):
  - `ObjectLockBucketConfig { enabled; mode?; defaultRetentionDays? }`
  - `ObjectLockObjectState { mode; retainUntil?: string; legalHold?: boolean }`
  - `EncryptionConfig { algorithm: 'AES256' | 'aws:kms' | null; kmsKeyId? }`
  - `CorsRule { id?; allowedOrigins: string[]; allowedMethods: ('GET'|'PUT'|'POST'|'DELETE'|'HEAD')[]; allowedHeaders?; exposeHeaders?; maxAgeSeconds? }`
  - `LifecycleRule { id; status: 'Enabled'|'Disabled'; prefix?; filter?: { tag?: { key; value }; sizeGreaterThan?; sizeLessThan? }; expirationDays?; expiredObjectDeleteMarker?; noncurrentVersionExpirationDays?; abortIncompleteMultipartUploadDays? }`
  - `PolicyDocument { Version: '2012-10-17'; Statement: Array<{ Sid?; Effect: 'Allow'|'Deny'; Principal: '*'|{ AWS: string|string[] }; Action: string|string[]; Resource: string|string[]; Condition?: Record<string, Record<string, string|string[]>> }> }`
  - `type TagSet = Record<string, string>`
- These types are imported by the `Bucket`, `ObjectEntity`, `ObjectVersion`, and `MultipartUpload` entities; the JSON columns on those entities use these as the TypeScript shape.

## Acceptance criteria
- [ ] `import { VersioningState, StorageClass, TagSet, CorsRule, LifecycleRule, PolicyDocument } from './types';` resolves and type-checks from the four entity files that use them.
- [ ] `VersioningState.Disabled === 'disabled'` and the other two values match exactly.

## Test obligations
- Unit: covered by [TEST-0201]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: _none_

## References
- `docs/WHITEPAPER.md` §3.2.1 (lines 3053–3128)
