// Generates the Open Graph / Twitter social-share card (1200×630) used as the
// docs site's default `themeConfig.image`. Regenerate after tweaking the design:
//
//   node apps/docs/scripts/gen-social-card.mjs
//
// Run from the repo root (needs the root node_modules for `sharp`).
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const W = 1200, H = 630;
const FONT = 'Inter, Helvetica, Arial, sans-serif';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="1" stop-color="#131c36"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#60a5fa"/>
    </linearGradient>
    <linearGradient id="bucket" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- subtle dotted grid -->
  <g fill="#ffffff" opacity="0.04">
    ${Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 15 }, (_, c) =>
        `<circle cx="${80 + c * 78}" cy="${70 + r * 78}" r="2.2"/>`
      ).join('')
    ).join('')}
  </g>

  <!-- top accent bar -->
  <rect x="80" y="96" width="72" height="8" rx="4" fill="url(#accent)"/>

  <!-- wordmark -->
  <text x="78" y="250" font-family="${FONT}" font-size="104" font-weight="800" fill="#ffffff" letter-spacing="-3">OpenBucket</text>

  <!-- tagline -->
  <text x="82" y="322" font-family="${FONT}" font-size="38" font-weight="600" fill="#cbd5e1">A self-hosted, S3-compatible object store.</text>
  <text x="82" y="372" font-family="${FONT}" font-size="38" font-weight="400" fill="#94a3b8">Run it as a container — or embed it in NestJS.</text>

  <!-- command pill -->
  <g>
    <rect x="82" y="430" width="470" height="58" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <text x="106" y="468" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="26" fill="#93c5fd">npm i @openbucket/nestjs</text>
  </g>

  <!-- footer url -->
  <text x="82" y="560" font-family="${FONT}" font-size="26" font-weight="500" fill="#64748b">github.com/ProjectBay/openbucket</text>

  <!-- decorative bucket glyph, right side -->
  <g transform="translate(880, 150)">
    <ellipse cx="150" cy="40" rx="150" ry="42" fill="url(#bucket)" opacity="0.25"/>
    <path d="M20 40 L60 320 Q62 340 82 340 L218 340 Q238 340 240 320 L280 40 Z" fill="url(#bucket)"/>
    <ellipse cx="150" cy="40" rx="130" ry="34" fill="#0b1020"/>
    <ellipse cx="150" cy="40" rx="130" ry="34" fill="none" stroke="#60a5fa" stroke-width="3" opacity="0.7"/>
    <!-- object bars inside -->
    <rect x="86" y="150" width="128" height="12" rx="6" fill="#bfdbfe" opacity="0.9"/>
    <rect x="86" y="192" width="128" height="12" rx="6" fill="#93c5fd" opacity="0.8"/>
    <rect x="86" y="234" width="128" height="12" rx="6" fill="#60a5fa" opacity="0.7"/>
  </g>
</svg>`;

const here = dirname(fileURLToPath(import.meta.url));
const out =
  process.argv[2] ??
  resolve(here, '../static/img/openbucket-social-card.png');
await sharp(Buffer.from(svg)).png().toFile(out);
console.log('wrote', out);
