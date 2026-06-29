---
id: TASK-1207
title: Implement RefreshTokenService.revoke (idempotent)
story: STORY-0402
status: done
type: implementation
size: XS
---

## Description
Revoke a refresh token by lookup. Idempotent: missing or already-revoked rows produce no error and no DB write.

## Files to create / modify
- `apps/backend/src/admin/auth/refresh-token.service.ts` — modify (add `revoke`)

## Implementation notes
- Verbatim from §5.2.3:
  ```ts
  async revoke(rawToken: string): Promise<void> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row || row.revokedAt) return;
    await this.repo.revoke(row.id, new Date());
  }
  ```

## Acceptance criteria
- [ ] No-op on unknown lookup.
- [ ] No-op on already-revoked rows.
- [ ] Otherwise sets `revokedAt = now` via repo.

## Test obligations
- Unit: covered by [TEST-0402]
- E2E: covered by [TEST-0406] (logout)
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1206]

## References
- `docs/WHITEPAPER.md` §5.2.3 (lines 6968–6974)
