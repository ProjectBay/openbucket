---
id: TASK-0615
title: Invoke `getMigrator().up()` at bootstrap
story: STORY-0205
status: done
type: implementation
size: XS
---

## Description
Run `app.get(MikroORM).getMigrator().up()` once during backend boot, before the HTTP listener binds. This is the forward-only, online schema-upgrade hook used in production. The call lives in `main.ts` (owned by [EPIC-01] bootstrap); this Task adds the single line plus its rationale comment.

## Files to create / modify
- `apps/openbucket-backend/src/main.ts` — modify (add migrator-up call before `app.listen(...)`)

## Implementation notes
- Snippet (verbatim from §3.3.2):
  ```ts
  const orm = app.get(MikroORM);
  await orm.getMigrator().up();
  ```
- Placement: after `app = await NestFactory.create(...)` and *before* `app.listen(...)`. This sequencing also matters for [STORY-0210] — the recovery scan registered via `OnApplicationBootstrap` runs after migrations land.
- Per §3.3.2: production never calls `down()`. The supported recovery for a bad migration is "restore the host-mounted volume from snapshot".

## Acceptance criteria
- [ ] Booting with an empty `DATA_DIR` creates `openbucket.db` with the initial migration applied; `orm:migration:list` reports it as up.
- [ ] Booting again with the same `DATA_DIR` is a no-op for the migrator.
- [ ] The migrator call precedes `app.listen` in source order.

## Test obligations
- Unit: covered by [TEST-0205]
- E2E: N/A (boot order verified indirectly by [TEST-0210])
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0614]

## References
- `docs/WHITEPAPER.md` §3.3.2 (lines 3670–3686)
