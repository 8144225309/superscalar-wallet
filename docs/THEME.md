# Theme system

Soupwallet supports light + dark themes. This doc explains how the
theme system is wired so new components don't break it.

## Mechanism

Theme state lives in Redux (`appConfig.uiConfig.appMode`) and is
mirrored to `<body data-bs-theme="...">` by `App.tsx`. Bootstrap's
SCSS `color-mode` mixin keys off this attribute to select per-mode
overrides.

## Two override files

- `src/styles/mode-light.scss` — wrapped in `@include color-mode(light)`
- `src/styles/mode-dark.scss` — wrapped in `@include color-mode(dark)`

Both ship a class set like `.text-contrast`, `.text-light`,
`.fill-primary`, etc. Components use these classes; the override
file picks the right concrete color for the active mode.

## What to use in component SCSS

| You want | Use |
|---|---|
| A theme color | `$primary`, `$success`, `$warning`, `$danger` (defined in `constants.scss`) — these resolve identically in both modes |
| Foreground text | class `text-contrast` (dark in light mode, light in dark mode) |
| Inverse foreground | class `text-white-dark` (the opposite of contrast) |
| Background | Bootstrap's `bg-body`, or omit (parent's background cascades) |
| SVG fill | classes `fill-primary`, `fill-strong-contrast`, `fill-contrast`, `fill-body-color`, `fill-body-bg` (see mode-*.scss for the full list) |
| Border / divider | `rgba(128, 128, 128, 0.2)` — neutral gray with alpha works in both modes without needing a per-mode override |

## What NOT to do

- **Don't hardcode `#fff` / `#000` / `#0C0C0F`** in component SCSS. These
  are mode-specific. Use a class from `mode-*.scss` or a CSS var.
- **Don't write `@media (prefers-color-scheme: ...)`**. Theme is
  user-controlled, not OS-controlled — the `data-bs-theme` attribute
  is the source of truth.
- **Don't introduce a new theme variant** (e.g. high-contrast,
  midnight). The two-mode system has been stable; a third is a
  cross-cutting change that needs a separate design pass.

## Verifying a new component

1. Toggle `Settings → Display → Theme: Dark/Light` (or the equivalent
   toggle wherever it lives in your build)
2. Visit every state of the new component
3. Confirm:
   - Foreground text remains readable
   - Borders are visible (not invisible against bg)
   - Icons remain visible (fill colors flip correctly)
   - Selected states (active row, active tab) stay legible

## Recent components, theme-checked

| Component | Verified theme-safe |
|---|---|
| Glossary modal | Yes — uses `rgba(128,128,128,*)` for dividers + tag bg |
| What's new modal | Yes — same |
| OperatorPrefs Reload button | Yes — Bootstrap variant classes |
| CloseButton helper | Yes — wraps existing `span-close-svg` class |

## What's NOT here

- High-contrast / custom palettes — out of scope; the two-mode system
  is the contract today
- Theme-aware images — `.qr-cln-logo` uses image switching based on
  `isDarkMode` Redux selector. New images should follow the same
  pattern; no automatic image flipping system.
- CSS custom properties for theme colors — Bootstrap's `color-mode`
  emits these implicitly; component SCSS reads through the class
  layer rather than directly. Keep it that way.
