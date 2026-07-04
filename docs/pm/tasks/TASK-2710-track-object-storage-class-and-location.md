---
id: TASK-2710
title: Extend the object data model to track storage-class/location and lifecycle transitions
story: STORY-0901
status: backlog
type: implementation
size: M
---

## Description

Add the persistent state that tiering needs: where an object's bytes physically
live (local FS vs the STORY-0900 remote), the remote object key, when it was
tiered, and a last-access timestamp that drives cold selection. Extend the
`LifecycleRule` shape to carry *transition* rules (Days + target `StorageClass`)
alongside the existing expiration fields, and add a per-rule sweep cursor entity
mirroring `LifecycleState`. A forward-only migration adds the columns.

## Files to create / modify

- `libs/nestjs/src/lib/persistence/entities/object.entity.ts` — modify (add
  `location`, `remoteKey`, `tieredAt`, `lastAccessedAt`)
- `libs/nestjs/src/lib/persistence/entities/types.ts` — modify (add
  `ObjectLocation` enum; extend `LifecycleRule` with `transitionDays` +
  `transitionStorageClass`)
- `libs/nestjs/src/lib/persistence/entities/tiering-state.entity.ts` — new
  (per-rule cursor, mirrors `lifecycle-state.entity.ts`)
- `libs/nestjs/src/lib/persistence/index.ts` — modify (export the new entity)
- `libs/nestjs/src/lib/migrations/Migration20260710000001_object_tiering.ts` — new
- `libs/nestjs/src/lib/persistence/entities/object-version.entity.ts` — modify
  (mirror the location columns so a tiered noncurrent version is tracked too)

## Implementation notes

- New enum in `types.ts`:
  ```ts
  export enum ObjectLocation {
    Local = 'local',        // blob is on the local FS (default, back-compat)
    Remote = 'remote',      // blob offloaded; row is a stub
    Rehydrating = 'rehydrating', // read-through in progress (single-flight marker)
  }
  ```
- New columns on `ObjectEntity` (match the existing `@Property` style — bigint
  size, defaulted enums, nullable extras):
  ```ts
  @Property({ type: 'string', default: ObjectLocation.Local })
  location: ObjectLocation = ObjectLocation.Local;

  /** Remote object key when tiered (key-codec encoded, bucket-scoped). Null when LOCAL. */
  @Property({ type: 'text', nullable: true }) remoteKey?: string;

  @Property({ type: 'datetime', nullable: true }) tieredAt?: Date;

  /** Read/HEAD access clock for cold selection; nullable ⇒ fall back to modifiedAt. */
  @Index({ name: 'ix_objects_lastaccessed' })
  @Property({ type: 'datetime', nullable: true }) lastAccessedAt?: Date;
  ```
  Keep `size`, `etag`, and `contentSha256` populated on the stub so HEAD/GET can
  answer metadata (and verify integrity after rehydrate) *without* touching the
  remote — the row stays the source of truth.
- Extend `LifecycleRule` (do not repurpose `expirationDays`; transition and
  expiration are independent):
  ```ts
  transitionDays?: number;
  transitionStorageClass?: 'STANDARD_IA' | 'GLACIER' | 'DEEP_ARCHIVE';
  ```
  Reuse existing `StorageClass` enum values (`types.ts`) — no new class needed.
- `TieringState` entity: copy `lifecycle-state.entity.ts` verbatim (composite PK
  `(bucket, ruleId)`, `lastKeyProcessed`, `lastSweepAt`) under table
  `tiering_state`; the sweep runner (TASK-2711) reuses the same cursor protocol.
- Migration (forward-only, §3.3.2 — mirror `Migration20260701000001`):
  ```sql
  alter table "objects" add column "location" varchar(16) not null default 'local';
  alter table "objects" add column "remote_key" text null;
  alter table "objects" add column "tiered_at" datetime null;
  alter table "objects" add column "last_accessed_at" datetime null;
  create index "ix_objects_lastaccessed" on "objects" ("last_accessed_at");
  -- same four columns on "object_versions";
  create table "tiering_state" (...composite PK, cascade on bucket...);
  ```
- Edge cases / security: `location` defaults to `local` so every pre-existing row
  is served exactly as today (no behaviour change until a transition rule + remote
  are configured). `remoteKey` is derived, not client-controlled — it is
  `encodeKey(key)` (see TASK-2711) so it inherits the `key-codec` path-safety
  guarantees and cannot be steered by a malicious object name. Keep the migration
  additive (nullable / defaulted) so a downgrade/boot on an old binary still reads
  the rows.

## Acceptance criteria

- [ ] `nx test nestjs --testPathPattern=object.entity` (and a new
      `tiering-state` metadata test) passes; MikroORM discovers the new entity.
- [ ] Running the migration on a DB seeded with pre-tiering rows leaves every row
      at `location='local'` and all existing GET/HEAD tests green.
- [ ] `LifecycleRule` type accepts a transition rule and the XML lifecycle
      parser round-trips `transitionDays` + `transitionStorageClass` without
      dropping expiration fields.

## Test obligations

- Unit: covered by [TEST-0901] (data-model / migration cases)
- E2E: covered by [TEST-0901]
- Conformance: N/A

## Dependencies

- Blocked by: [STORY-0900] (defines the remote target the columns describe)
