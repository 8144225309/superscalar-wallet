# HTTP security headers

Every response from the wallet HTTP server carries a set of defense-
in-depth headers. The full set is defined in `apps/backend/source/server.ts`
inside the global middleware. This doc explains *why* each one is set
the way it is, so future audits don't have to reverse-engineer intent.

## Content-Security-Policy

```
default-src 'self';
font-src 'self';
img-src 'self' data:;
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' wss: https:;
frame-src 'none';
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
```

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Locks all default fetches to wallet origin. |
| `font-src` | `'self'` | All fonts ship bundled; no Google Fonts etc. |
| `img-src` | `'self' data:` | `data:` lets us inline QR codes and small icons. |
| `script-src` | `'self'` | No inline scripts, no external CDNs. |
| `style-src` | `'self' 'unsafe-inline'` | `'unsafe-inline'` required for `react-perfect-scrollbar`, which injects `<style>` at runtime (Dashboard / #158 repro). Tradeoff documented inline. |
| `connect-src` | `'self' wss: https:` | `wss:` permits user-configured Nostr relays for rendezvous; `https:` reserved for any coordinator info endpoint. Keeping wide because the relay set is operator-configurable per network. |
| `frame-src` | `'none'` | We never embed iframes. |
| `frame-ancestors` | `'none'` | Nobody embeds us — anti-clickjacking. Complements `X-Frame-Options: DENY`. |
| `object-src` | `'none'` | No Flash, applet, PDF embed. |
| `base-uri` | `'self'` | Locks `<base>` to prevent dangling-markup injection. |
| `form-action` | `'self'` | Forms can only submit same-origin. |

## Other headers

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Browser must honor declared `Content-Type` — kills MIME confusion attacks. |
| `X-Frame-Options` | `DENY` | Anti-clickjacking. Belt + suspenders with `frame-ancestors 'none'`. |
| `Referrer-Policy` | `same-origin` | Outbound clicks send no `Referer` to third parties — prevents leaking internal paths / IDs. |
| `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()` | Browser feature kill-switch. Reduces blast radius of an XSS that the CSP somehow lets through. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production+https only) | One year HSTS. Only set when `NODE_ENV=production` AND `APP_PROTOCOL=https` — issuing it over http would lock browsers to a scheme the server can't honor. |

## Why no `helmet`

The standard answer in Express-land is "use helmet." We don't, because:

- The middleware above is fewer than 30 lines and easier to audit
  than helmet's chain of conditional behaviors.
- helmet's defaults change between major versions; an explicit
  policy survives upgrades.
- No new dep to track.

If a future review wants helmet for completeness, swap the block
above for helmet({...}) with the same set of directives.

## Audit notes — when changing CSP

1. Run the app locally in a real browser (not just curl).
2. Watch the JS console for CSP violation errors.
3. If you add a new external resource (font, image, script), declare
   it explicitly in the appropriate directive — don't widen
   `default-src`.
4. The `'unsafe-inline'` on `style-src` is the only blanket
   exception. Avoid adding any other `unsafe-*` value.
5. Test the rendezvous browse/advertise flow if you touch
   `connect-src` — those need outbound `wss:` to whatever relay set
   the operator configured.

## What's NOT here

- `Cross-Origin-Embedder-Policy` / `Cross-Origin-Resource-Policy` /
  `Cross-Origin-Opener-Policy` — these enable `SharedArrayBuffer` and
  isolate browsing contexts. We don't currently need them; revisit if
  a future feature wants COI.
- Subresource Integrity — all scripts are first-party; SRI matters
  for CDN-loaded scripts which we don't have.
- Reporting endpoints (`Report-To`, `report-uri`) — no aggregation
  infrastructure today. Browser CSP violations land in the user's
  console. Add a reporter when we have somewhere to ship them.
