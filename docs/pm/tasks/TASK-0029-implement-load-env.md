---
id: TASK-0029
title: Implement loadEnv with multiline stderr formatting
story: STORY-0011
status: done
type: implementation
size: XS
---

## Description
Implement `loadEnv(raw: Record<string, unknown>): Env` in `env.schema.ts` per §1.7. On `safeParse` failure, format each issue as `'  - ${path}: ${message}'`, write to `console.error`, and throw `new Error('Refusing to boot: invalid environment.')`. `ConfigModule.forRoot({ validate: loadEnv })` (STORY-0004) turns the throw into a fatal boot error.

## Files to create / modify
- `apps/openbucket-backend/src/common/config/env.schema.ts` — modify

## Implementation notes
- Quote §1.7 (lines 769–780) verbatim:
  ```ts
  export function loadEnv(raw: Record<string, unknown>): Env {
    const result = EnvSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
      console.error(`Invalid environment configuration:\n${issues}`);
      throw new Error('Refusing to boot: invalid environment.');
    }
    return result.data;
  }
  ```
- The stderr prefix string is `'Invalid environment configuration:\n'`.
- The thrown message is `'Refusing to boot: invalid environment.'` — both are load-bearing for documentation / ops runbooks.

## Acceptance criteria
- [ ] `loadEnv({})` writes the multiline diagnostic to stderr and throws with the exact message `'Refusing to boot: invalid environment.'`.
- [ ] `loadEnv(validEnv)` returns the parsed `Env` object.
- [ ] Issues with empty path are labelled `(root)`.

## Test obligations
- Unit: covered by [TEST-0012]
- E2E: N/A
- Conformance: N/A

## Dependencies
- Blocked by: [TASK-0028]

## References
- `docs/WHITEPAPER.md` §1.7 (lines 765–781)
