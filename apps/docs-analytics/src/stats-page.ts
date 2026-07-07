// Renders the /stats dashboard as a single self-contained HTML document
// (inline CSS, no external requests — CSP- and offline-friendly).

import type { Bucket, Stats } from './db.js';

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );
}

function rows(items: Bucket[], label: string): string {
  if (items.length === 0) return `<tr><td colspan="3" class="empty">no data yet</td></tr>`;
  const max = Math.max(...items.map((i) => i.views), 1);
  return items
    .map((i) => {
      const pct = Math.round((i.views / max) * 100);
      return `<tr>
        <td class="key"><span class="bar" style="width:${pct}%"></span><span class="lbl" title="${esc(i.key)}">${esc(i.key)}</span></td>
        <td class="num">${i.views.toLocaleString('en-US')}</td>
        <td class="num">${i.uniques.toLocaleString('en-US')}</td>
      </tr>`;
    })
    .join('');
}

function perDayChart(perDay: Bucket[]): string {
  if (perDay.length === 0) return `<p class="empty">no data yet</p>`;
  const max = Math.max(...perDay.map((d) => d.views), 1);
  return `<div class="chart" role="img" aria-label="Pageviews per day">
    ${perDay
      .map((d) => {
        const h = Math.max(2, Math.round((d.views / max) * 100));
        return `<div class="col" title="${esc(d.key)}: ${d.views} views / ${d.uniques} visitors">
          <div class="colbar" style="height:${h}%"></div>
        </div>`;
      })
      .join('')}
  </div>
  <div class="chart-axis"><span>${esc(perDay[0]!.key)}</span><span>${esc(perDay[perDay.length - 1]!.key)}</span></div>`;
}

export function renderDashboard(s: Stats, days: number): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>OpenBucket docs — traffic</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#2a7ae2; --bar:#dbeafe; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0f14; --fg:#e5e7eb; --muted:#9ca3af; --line:#1f2937; --accent:#60a5fa; --bar:#14304f; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
  .kpis { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
  .kpi { flex: 1 1 160px; border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
  .kpi .n { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
  .kpi .t { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .card { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 22px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tr:last-child td { border-bottom: 0; }
  td.key { position: relative; max-width: 0; }
  .bar { position: absolute; inset: 2px auto 2px 0; background: var(--bar); border-radius: 4px; z-index: 0; }
  .lbl { position: relative; z-index: 1; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.num { text-align: right; width: 84px; font-variant-numeric: tabular-nums; color: var(--fg); }
  thead td { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid var(--line); }
  .empty { color: var(--muted); font-style: italic; }
  .chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
  .col { flex: 1 1 0; display: flex; align-items: flex-end; height: 100%; }
  .colbar { width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; opacity: .85; }
  .chart-axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; margin-top: 6px; }
  footer { color: var(--muted); font-size: 12px; margin-top: 8px; }
  code { background: var(--line); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style></head>
<body><div class="wrap">
  <h1>OpenBucket docs — traffic</h1>
  <p class="sub">Last ${days} days (since ${esc(s.since)}, UTC) · cookieless, first-party · no third-party services</p>

  <div class="kpis">
    <div class="kpi"><div class="n">${s.totalViews.toLocaleString('en-US')}</div><div class="t">Pageviews</div></div>
    <div class="kpi"><div class="n">${s.totalUniques.toLocaleString('en-US')}</div><div class="t">Unique visitors</div></div>
    <div class="kpi"><div class="n">${s.perDay.length.toLocaleString('en-US')}</div><div class="t">Days with traffic</div></div>
  </div>

  <div class="card"><h2>Pageviews per day</h2>${perDayChart(s.perDay)}</div>

  <div class="card"><h2>Top pages</h2>
    <table><thead><tr><td>Path</td><td class="num">Views</td><td class="num">Uniq</td></tr></thead>
    <tbody>${rows(s.topPaths, 'path')}</tbody></table>
  </div>

  <div class="card"><h2>Top referrers</h2>
    <table><thead><tr><td>Referrer</td><td class="num">Views</td><td class="num">Uniq</td></tr></thead>
    <tbody>${rows(s.topReferrers, 'referrer')}</tbody></table>
  </div>

  <footer>Machine-readable: <code>GET /stats.json?days=${days}</code> (same bearer token).</footer>
</div></body></html>`;
}
