---
id: TASK-0616
title: Implement `BucketRepository`
story: STORY-0206
status: done
type: implementation
size: S
---

## Description
Implement the bucket-facing repository extending MikroORM's `EntityRepository<Bucket>` with the helpers consumed by every S3 handler.

## Files to create / modify
- `libs/persistence/src/repositories/bucket.repository.ts` — new

## Implementation notes
- Extends `EntityRepository<Bucket>` from `@mikro-orm/better-sqlite`.
- Methods (signatures verbatim from §3.4.1):
  - `async getByName(name: string): Promise<Bucket | null>` — `return this.findOne({ name });`
  - `async exists(name: string): Promise<boolean>` — `const row = await this.findOne({ name }, { fields: ['name'] }); return row !== null;`
  - `async isVersioned(name: string): Promise<boolean>` — `const row = await this.findOne({ name }, { fields: ['versioning'] }); return row?.versioning === VersioningState.Enabled;`
  - `async hasVersionHistory(name: string): Promise<boolean>` — `return row?.versioning !== VersioningState.Disabled;` (true when Enabled *or* Suspended).
  - `async listAll(): Promise<Bucket[]>` — `return this.findAll({ orderBy: { name: 'ASC' } });`

## Acceptance criteria
- [ ] All five methods exist and have the exact signatures above.
- [ ] `exists('missing')` returns `false`; `exists('present')` returns `true`.
- [ ] `isVersioned` returns `true` only for `Enabled`, not `Suspended`.
- [ ] `hasVersionHistory` returns `true` for both `Enabled` and `Suspended`.

## Test obligations
- Unit: covered by [TEST-0206]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0604]

## References
- `docs/WHITEPAPER.md` §3.4.1 (lines 3694–3732)
