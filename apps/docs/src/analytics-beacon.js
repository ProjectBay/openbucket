// Cookieless, first-party pageview beacon for the OpenBucket docs site.
//
// Sends an anonymous ping to the self-hosted collector whose URL is injected at
// build time from `DOCS_ANALYTICS_URL` (see docusaurus.config.js) and exposed as
// `window.__OB_DOCS_ANALYTICS__`. It is a complete no-op when that is unset — so
// local dev and PR/preview builds never phone home — and it honors Do Not Track.
//
// No cookies, no localStorage, no identifiers are set client-side.

export function onRouteDidUpdate({ location, previousLocation }) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  // A hash/query-only change to the same page is not a new pageview.
  if (previousLocation && previousLocation.pathname === location.pathname) return;

  const cfg = window.__OB_DOCS_ANALYTICS__;
  if (!cfg || !cfg.url) return;

  // Respect Do Not Track.
  const dnt = navigator.doNotTrack || window.doNotTrack;
  if (dnt === '1' || dnt === 'yes') return;

  try {
    const payload = JSON.stringify({
      path: location.pathname,
      referrer: document.referrer || '',
      screenW: (window.screen && window.screen.width) || 0,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    });
    if (navigator.sendBeacon) {
      // A string body is sent as text/plain → a CORS "simple request" (no preflight).
      navigator.sendBeacon(cfg.url, payload);
    } else {
      fetch(cfg.url, { method: 'POST', body: payload, keepalive: true, mode: 'no-cors' }).catch(
        () => {},
      );
    }
  } catch {
    // Analytics must never break the page.
  }
}
