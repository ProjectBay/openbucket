---
id: TASK-1206
title: Implement RefreshTokenService.rotate with reuse-detection
story: STORY-0402
status: done
type: implementation
size: M
---

## Description
Rotate a refresh token. Find row by lookup; reject revoked / expired tokens; if `rotatedAt` is already set, the token was reused — revoke the entire chain (`repo.revokeDescendants(row.id)`) and throw `'token reuse detected'`. Otherwise argon2-verify, mark rotated, mint a child carrying `rotatedFromId = row.id`, and return `{ token, expiresAt, subjectId, username }`.

## Files to create / modify
- `apps/backend/src/admin/auth/refresh-token.service.ts` — modify (add `rotate`)

## Implementation notes
- Verbatim from §5.2.3 lines 6946–6966:
  ```ts
  async rotate(rawToken: string): Promise<RotatedRefresh> {
    const lookup = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.repo.findByLookup(lookup);
    if (!row) throw new UnauthorizedException('invalid refresh');

    if (row.revokedAt) throw new UnauthorizedException('revoked');
    if (row.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('expired');

    if (row.rotatedAt) {
      // Reuse of an already-rotated token — treat as compromise.
      await this.repo.revokeDescendants(row.id);
      throw new UnauthorizedException('token reuse detected');
    }

    const ok = await argon2.verify(row.hash, rawToken);
    if (!ok) throw new UnauthorizedException('invalid refresh');

    await this.repo.markRotated(row.id, new Date());
    const minted = await this.mint(row.subjectId, row.username, row.id);
    return { ...minted, subjectId: row.subjectId, username: row.username };
  }
  ```
- The lookup column is a fast SHA-256 used solely to find the row; argon2 is the cryptographic gate.

## Acceptance criteria
- [ ] `rotate` returns `RotatedRefresh = MintedRefresh & { subjectId, username }` on success.
- [ ] On unknown lookup or hash mismatch → `UnauthorizedException('invalid refresh')`.
- [ ] On `revokedAt` set → `'revoked'`.
- [ ] On expiry → `'expired'`.
- [ ] On `rotatedAt` already set → `repo.revokeDescendants(row.id)` is called and `'token reuse detected'` is thrown.
- [ ] Successful path calls `repo.markRotated(id, now)` then `mint(subjectId, username, id)`.

## Test obligations
- Unit: covered by [TEST-0402]
- E2E: covered by [TEST-0403]
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-1205]

## References
- `docs/WHITEPAPER.md` §5.2.3 (lines 6946–6977)
