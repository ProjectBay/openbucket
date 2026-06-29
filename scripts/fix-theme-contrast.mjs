#!/usr/bin/env node
/*
 * One-time contrast fixer (STORY-0616 / TASK-1884). For each failing token pair it
 * nudges the lightness (L) of whichever endpoint sits closer to mid-luminance,
 * moving it away from the other endpoint until WCAG contrast is met. Hue/chroma are
 * preserved, so bright accents simply darken (keeping the conventional light button
 * text) and grey rings/labels deepen. Idempotent; re-run `check-theme-contrast.mjs`
 * to verify.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

const pairs = [
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
const TARGET = 0.12; // headroom above the threshold

function parseBlockTokens(blockText) {
  const tokens = {};
  for (const line of blockText.split('\n')) {
    const mm = line.match(/--([\w-]+):\s*oklch\(([^)]+)\)/);
    if (!mm || mm[2].includes('/')) continue;
    const p = mm[2].trim().split(/\s+/);
    tokens['--' + mm[1]] = [parseFloat(p[0]), parseFloat(p[1] ?? '0') || 0, parseFloat(p[2] ?? '0') || 0];
  }
  return tokens;
}

// Solve a block: return a map of token -> new L for tokens that must change.
function solveBlock(tokens) {
  const work = {};
  for (const k of Object.keys(tokens)) work[k] = [...tokens[k]];
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const [fg, bg, min] of pairs) {
      if (!work[fg] || !work[bg]) continue;
      if (contrast(work[fg], work[bg]) >= min + TARGET - 0.001) continue;
      // Move the endpoint closer to mid-luminance (0.5), away from the other.
      const fgMid = Math.abs(work[fg][0] - 0.5);
      const bgMid = Math.abs(work[bg][0] - 0.5);
      const moverKey = fgMid <= bgMid ? fg : bg;
      const otherKey = moverKey === fg ? bg : fg;
      const dir = luminance(work[otherKey]) > luminance(work[moverKey]) ? -1 : 1; // away
      const mover = work[moverKey];
      let L = mover[0];
      for (let i = 0; i < 220; i++) {
        const test = [Math.max(0, Math.min(1, L + dir * 0.005)), mover[1], mover[2]];
        if (
          (dir < 0 && test[0] <= 0) ||
          (dir > 0 && test[0] >= 1) ||
          contrast(moverKey === fg ? test : work[fg], moverKey === bg ? test : work[bg]) >=
            min + TARGET
        ) {
          L = test[0];
          break;
        }
        L = test[0];
      }
      work[moverKey] = [Math.round(L * 1000) / 1000, mover[1], mover[2]];
      changed = true;
    }
    if (!changed) break;
  }
  const diffs = {};
  for (const k of Object.keys(work)) {
    if (work[k][0] !== tokens[k][0]) diffs[k] = work[k][0];
  }
  return diffs;
}

let totalChanged = 0;
for (const file of readdirSync(themesDir).filter((f) => f.endsWith('.css'))) {
  const path = join(themesDir, file);
  let css = readFileSync(path, 'utf8');
  const out = [];
  let block = null;
  const blockDiffs = {};
  // First pass: collect block texts to solve.
  const lines = css.split('\n');
  let buf = [];
  for (const line of lines) {
    if (/:root\s*\{/.test(line)) block = 'root';
    else if (/\.dark\s*\{/.test(line)) block = 'dark';
    if (block && line.includes('{') && buf.length === 0) {
      buf = [];
    }
    if (block) buf.push(line);
    if (block && line.includes('}')) {
      blockDiffs[block] = solveBlock(parseBlockTokens(buf.join('\n')));
      block = null;
      buf = [];
    }
  }
  // Second pass: rewrite token L values per block.
  block = null;
  for (const line of lines) {
    if (/:root\s*\{/.test(line)) block = 'root';
    else if (/\.dark\s*\{/.test(line)) block = 'dark';
    let outLine = line;
    if (block && blockDiffs[block]) {
      const mm = line.match(/(\s*)--([\w-]+):\s*oklch\(([^)]+)\)(.*)/);
      if (mm && !mm[3].includes('/')) {
        const key = '--' + mm[2];
        if (blockDiffs[block][key] !== undefined) {
          const p = mm[3].trim().split(/\s+/);
          p[0] = String(blockDiffs[block][key]);
          outLine = `${mm[1]}${key}: oklch(${p.join(' ')})${mm[4]}`;
          totalChanged++;
        }
      }
    }
    out.push(outLine);
    if (block && line.includes('}')) block = null;
  }
  writeFileSync(path, out.join('\n'));
}
console.log(`Adjusted ${totalChanged} token L values across themes.`);
