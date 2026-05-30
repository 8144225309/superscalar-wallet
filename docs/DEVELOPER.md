# Developer workflow

How to work on the codebase locally. Companion to [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md)
(which is about running a built wallet) and [REPO_GOVERNANCE.md](REPO_GOVERNANCE.md)
(which is about branch protection / PR rules).

## One-time setup

```sh
git clone https://github.com/8144225309/superscalar-wallet
cd superscalar-wallet
npm ci
```

Workspaces: `apps/backend`, `apps/frontend`. Root scripts proxy into
each workspace.

## Day-to-day

| Task | Command |
|---|---|
| Run wallet (dev) | `npm run dev` |
| Build wallet (prod-style) | `npm run build` |
| Lint everything | `npm run lint` |
| Lint backend only | `npm run backend:lint` |
| Lint frontend only | `npm run frontend:lint` |
| Run all tests | `npm run backend:test && npm run frontend:test` |
| Run backend tests only (fastest) | `npm run backend:test` |
| Run frontend tests only | `npm run frontend:test` |
| Format backend | `npm run backend:format` |
| Check backend format (no write) | `npm run backend:format-check` |

## Testing

- **Backend**: vitest (`apps/backend/vitest.config.ts`). Co-located
  `*.test.ts` next to the source file. Single command:
  `npm run backend:test`.
- **Frontend**: react-scripts test (Jest). Co-located `*.test.ts(x)`.
  `npm run frontend:test`.
- **e2e**: puppeteer scripts at `apps/frontend/e2e/`. Manual / not in
  CI. See `apps/frontend/e2e/README.md`.

CI runs frontend tests + backend tests on every PR. Build job
compiles TS for both workspaces.

## Formatting

Backend uses prettier 3.6 with the upstream cln-application config.
The `build`, `start`, and `watch` scripts auto-run `prettier --write`
before tsc, so committed code is always formatted by the time CI
sees it.

`format:check` is a verifier that does NOT write — useful for CI
gating once the existing format drift is cleaned up. Currently CI
does NOT enforce format-check (37 source files have drift from
historical edits). To clean up: `npm run backend:format` then commit
the diff as a single dedicated PR.

Frontend has no separate prettier step; react-scripts handles
formatting through its lint rules.

## Pre-commit

No automated hooks. To run the full pre-commit check manually before
opening a PR:

```sh
npm run lint
npm run backend:format-check    # currently soft — drift exists
npm run backend:test
npm run frontend:test
```

## When to run what

| Change | Minimal verification |
|---|---|
| Backend logic | `backend:lint && backend:test` |
| Backend security/auth | + `backend:format-check` |
| Frontend component | `frontend:lint && frontend:test` |
| New SCSS | run dev server, verify at xs/sm/md/lg/xl widths (see [RESPONSIVE.md](RESPONSIVE.md)) and dark+light themes (see [THEME.md](THEME.md)) |
| New CSP-affecting code | run dev server, check browser console for CSP violations |
| Plugin RPC contract | also test against a regtest CLN with the plugin loaded (see [CLIENT_JOIN_DEMO.md](CLIENT_JOIN_DEMO.md)) |

## What's NOT here

- Husky / lint-staged pre-commit hooks (not configured; rely on CI)
- Coverage gating (no minimum coverage threshold enforced)
- Type-coverage tooling (`type-coverage`) — could be a follow-up
- Storybook / component sandbox (not used)

## See also

- [RELEASING.md](RELEASING.md) — version bumping, tagging, GH releases
- [REPO_GOVERNANCE.md](REPO_GOVERNANCE.md) — branch protection rules
- [SECURITY_HEADERS.md](SECURITY_HEADERS.md) — CSP audit notes
- [CONFORMANCE.md](CONFORMANCE.md) — wallet-side deviations from bLIP-56
