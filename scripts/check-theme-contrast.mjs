#!/usr/bin/env node
/*
 * Token-contrast check (STORY-0616 / TASK-1884). Parses every theme in
 * apps/openbucket-frontend/src/styles/themes/*.css, converts the OKLCH design
 * tokens to relative luminance, and asserts WCAG 1.4.3 contrast for the key
 * foreground/background pairs (4.5:1 text, 3:1 non-text focus ring) in both the
 * light (:root) and dark (.dark) modes. Exits non-zero on any failure.
 *
 * Run: node scripts/check-theme-contrast.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const themesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'openbucket-frontend',
  'src',
  'styles',
  'themes',
);

// OKLCH (L 0..1, C, H deg) -> linear sRGB (Björn Ottosson's oklab matrices).
function oklchToLinearRGB(L, C, H) {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// WCAG relative luminance from linear sRGB.
function luminance([L, C, H]) {
  const [r, g, b] = oklchToLinearRGB(L, C, H).map((v) => Math.max(0, Math.min(1, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseBlock(css, selector) {
  const re = new RegExp(selector.replace('.', '\\.') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  if (!m) return {};
  const tokens = {};
  for (const line of m[1].split(';')) {
    const mm = line.match(/--([\w-]+):\s*oklch\(([^)]+)\)/);
    if (!mm) continue;
    if (mm[2].includes('/')) continue; // skip alpha tokens (borders etc.)
    const parts = mm[2].trim().split(/\s+/);
    tokens['--' + mm[1]] = [
      parseFloat(parts[0]),
      parseFloat(parts[1] ?? '0') || 0,
      parseFloat(parts[2] ?? '0') || 0,
    ];
  }
  return tokens;
}

// [foreground, background, minimum ratio]
const pairs = [
  ['--foreground', '--background', 4.5],
  ['--card-foreground', '--card', 4.5],
  ['--popover-foreground', '--popover', 4.5],
  ['--muted-foreground', '--background', 4.5],
  ['--muted-foreground', '--muted', 4.5],
  ['--primary-foreground', '--primary', 4.5],
  ['--secondary-foreground', '--secondary', 4.5],
  ['--accent-foreground', '--accent', 4.5],
  ['--sidebar-foreground', '--sidebar', 4.5],
  ['--sidebar-primary-foreground', '--sidebar-primary', 4.5],
  ['--sidebar-accent-foreground', '--sidebar-accent', 4.5],
  ['--ring', '--background', 3.0],
  ['--sidebar-ring', '--sidebar', 3.0],
];

let failures = 0;
let checks = 0;
for (const file of readdirSync(themesDir).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(join(themesDir, file), 'utf8');
  for (const [sel, mode] of [
    [':root', 'light'],
    ['.dark', 'dark'],
  ]) {
    const t = parseBlock(css, sel);
    for (const [fg, bg, min] of pairs) {
      if (!t[fg] || !t[bg]) continue;
      checks++;
      const ratio = contrast(t[fg], t[bg]);
      if (ratio < min - 0.005) {
        failures++;
        console.log(
          `FAIL ${file.padEnd(12)} [${mode}] ${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`,
        );
      }
    }
  }
}

console.log(
  failures === 0
    ? `OK — ${checks} theme token pairs pass WCAG contrast.`
    : `\n${failures} contrast failure(s) across ${checks} checks.`,
);
process.exit(failures === 0 ? 0 : 1);
