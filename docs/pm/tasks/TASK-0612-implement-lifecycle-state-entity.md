---
id: TASK-0612
title: Implement `LifecycleState` entity
story: STORY-0204
status: done
type: implementation
size: XS
---

## Description
Implement the resume-cursor entity tracking the lifecycle sweep progress per bucket × rule. The cursor lets [EPIC-04]'s sweep tick resume after restart without rescanning a fully-processed prefix.

## Files to create / modify
- `libs/persistence/src/entities/lifecycle-state.entity.ts` — new

## Implementation notes
- `@Entity({ tableName: 'lifecycle_state' })`.
- Composite PK:
  - `@ManyToOne(() => Bucket, { primary: true, fieldName: 'bucket_name', deleteRule: 'cascade' }) bucket!: Bucket;`
  - `@PrimaryKey({ type: 'string', length: 64 }) ruleId!: string;`
- `@Property({ type: 'datetime', nullable: true }) lastSweepAt?: Date;`.
- `@Property({ type: 'text', nullable: true }) lastKeyProcessed?: string;` — resume cursor: the last key fully processed during the previous tick.

## Acceptance criteria
- [ ] Inserting a row with `lastKeyProcessed = undefined` persists `NULL`.
- [ ] Deleting the bucket cascades the lifecycle state rows.

## Test obligations
- Unit: covered by [TEST-0204]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0604]

## References
- `docs/WHITEPAPER.md` §3.2.9 (lines 3449–3472)
