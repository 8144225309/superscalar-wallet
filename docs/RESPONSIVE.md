# Responsive design

Soupwallet targets four canonical viewport widths. New components and
SCSS additions should be verified at each.

## Breakpoints

| Name | Width | Typical device | Mixin |
|---|---|---|---|
| xxs | ≤360px | iPhone SE, foldable inner | `@include xxs-down` |
| xs | ≤575px | mobile portrait | `@include xs-down` |
| sm | ≤767px | mobile landscape, small tablet | `@include sm-down` |
| md | ≤991px | tablet portrait | `@include md-down` |
| lg | ≤1199px | tablet landscape, small desktop | `@include lg-down` |
| (none) | ≥1200px | desktop | — |

Values match Bootstrap's container widths so SCSS mixins and
`col-xs-*` agree about what counts as "extra small."

## Convention

- **Prefer `-down` mixins.** The wallet's base styling targets desktop;
  smaller viewports get overrides via `@include xs-down { ... }`.
- **Do not introduce a new breakpoint** unless something at the
  existing values is wrong. The set above covers nearly every
  real-world device.
- **Test the four widths during PR review** when touching layout
  SCSS. The e2e/ harness can take screenshots at each (see
  R5.1 puppeteer suite).

## Known-tight surfaces

These have been adjusted historically — keep an eye on them when
changing layout.

| Surface | Tightest viewport | Notes |
|---|---|---|
| Header / top nav | xxs | PR #178 added compact-mode shrink |
| FactoryList rows | xs | PR #65 row flex-wrap |
| FactoryDetail accordion | xs | PR #63/#65 |
| Connect modal Network dropdown | xs | Dropdown can clip — verify on small phones |
| Settings dropdown menu | xs | Anchors right at xs, full-width on xxs |
| Glossary modal | xs | PR #77; modal-lg degrades cleanly |
| What's new modal | xs | PR #78; modal-lg degrades cleanly |

## Verifying

### Manual

1. Browser devtools → device emulation
2. Step through 360 / 575 / 991 / 1440px widths
3. Look for: horizontal scrollbar (overflow), buttons clipped or
   wrapped weirdly, text in unreadable sizes

### Puppeteer (R5.1)

```sh
WALLET_URL=http://localhost:2103 \
  WALLET_PASSWORD=demopassword \
  CHROME_PATH=/usr/bin/google-chrome \
  SHOT_DIR=/tmp/soupwallet-e2e/desktop \
  node apps/frontend/e2e/golden-path.mjs
```

Modify `helpers.mjs` `setViewport({ width: 360, height: 800 })`
for a mobile run; eventually we can parameterize this via env var.

## What's NOT here

- Container queries (`@container`) — supported in modern browsers but
  the layout doesn't currently use them; viewport-based breakpoints
  remain the convention.
- Aspect-ratio media queries — same.
- Print stylesheet — wallet isn't printed; no use case.
