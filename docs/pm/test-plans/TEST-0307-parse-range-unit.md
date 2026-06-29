---
id: TEST-0307
title: parseRange unit tests covering the §4.3 table
covers: [STORY-0304, TASK-0913]
status: done
level: unit
---

## Goal
Reproduce the validation table from §4.3 verbatim against `parseRange(header, 1000)`.

## Setup
- Pure Jest unit; no Nest, no fs.

## Cases
For `size = 1000`, the following inputs must produce these outputs:
| Input | Expected |
|---|---|
| `bytes=0-499` | `{ start: 0, end: 499 }` |
| `bytes=500-` | `{ start: 500, end: 999 }` |
| `bytes=-200` | `{ start: 800, end: 999 }` |
| `bytes=999-2000` | `{ start: 999, end: 999 }` |
| `bytes=1000-` | `'invalid'` |
| `bytes=0-` | `{ start: 0, end: 999 }` |
| `bytes=0-100,200-300` | `'invalid'` |
| `bytes=` | `'invalid'` |
| `items=0-99` | `'invalid'` |

Plus:
1. `bytes=-0` → `'invalid'` (suffix must be positive).
2. `bytes=abc-def` → `'invalid'`.
3. `bytes=10-5` → `'invalid'` (start > end).
4. `bytes=-500` against `size = 0` → `'invalid'`.

## Tooling
- Framework: jest
- Runner: `nx test backend --testPathPattern=range.spec.ts`

## Pass criteria
- [ ] All 13 inputs (table + extra) produce the expected outputs.

## References
- `docs/WHITEPAPER.md` §4.3 (lines 5631–5717)
