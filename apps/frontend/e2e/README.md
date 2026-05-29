# Soupwallet e2e

Puppeteer-driven UI smoke tests. Not part of the standard test suite —
these run against a live wallet instance and capture screenshots. They
exist to catch regressions in the golden-path flows.

## Layout

- `lib/helpers.mjs` — shared puppeteer helpers (launch, login, nav, screenshot)
- `golden-path.mjs` — single-profile golden-path sweep (factories list, detail, settings)
- `profile-switch.mjs` — two-profile sweep (LSP perspective → client perspective)

## Running

Requires `puppeteer-core` and a local Chrome / Chromium install.

```sh
cd apps/frontend
npm install puppeteer-core --no-save     # if not already installed
WALLET_URL=http://localhost:2103 \
  WALLET_PASSWORD=demopassword \
  CHROME_PATH=/usr/bin/google-chrome \
  SHOT_DIR=/tmp/soupwallet-e2e \
  node e2e/golden-path.mjs
```

| Env var | Default | Meaning |
|---|---|---|
| `WALLET_URL` | `http://localhost:2103` | Where to hit the wallet |
| `WALLET_PASSWORD` | (none — required if APP_SINGLE_SIGN_ON=false) | Login password |
| `CHROME_PATH` | platform default | Chrome / Chromium binary |
| `SHOT_DIR` | `/tmp/soupwallet-e2e` | Where to drop screenshots |
| `HEADLESS` | `new` | Set to `false` for visual debugging |
| `LSP_PROFILE` | `alice` | Profile to use for the LSP role |
| `CLIENT_PROFILE` | `bob` | Profile to use for the client role |

## What's NOT here

- CI integration — these run against a live wallet; CI runs unit tests
  in `apps/frontend/src/**/*.test.tsx`
- Auth bypass — if `APP_SINGLE_SIGN_ON=true`, the scripts skip login;
  if `false`, `WALLET_PASSWORD` must be set
- Cleanup — screenshots accumulate in `SHOT_DIR`; rotate or wipe
  manually
- Cross-browser — Chromium only

## Origin

These started as ad-hoc `*-sweep.mjs` scripts at the repo root during
the R1-R3 polish rounds. The durable parts landed here as R5.1; the
ad-hoc one-shots stay out of the repo.
