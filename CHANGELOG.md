# Changelog

All notable changes to the soupwallet UI are recorded here. Versioning
follows calver (`YY.MM[.N]`) inherited from upstream cln-application.

## [Unreleased]

### Added
- R7.6 — defense-in-depth HTTP headers (HSTS conditional on prod+https, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) + tightened CSP (frame-src/frame-ancestors/object-src/base-uri/form-action all locked down).
- R7.5 — `docs/OPERATOR_RUNBOOK.md` covering install / env vars / first-run / common ops / troubleshooting.
- R7.4 — `/v1/shared/metrics` Prometheus endpoint; counters for auth login total/success/failure, rate-limit hits, http 5xx.
- R7.3 — `scripts/apply-branch-protection.sh` + `docs/REPO_GOVERNANCE.md` documenting main-branch protection rules.
- R7.2 — `Settings → Export Config` / `Import Config`; `docs/SEED_BACKUP.md` clarifying wallet UI vs. CLN `hsm_secret` scope.
- R7.1 — mainnet auth hardening: per-IP rate limit on /login (5/15min) + /reset (3/hr), `APP_JWT_SECRET` env var for stable session secret, server-side hash-format gate, secure+sameSite cookie flags, `docs/MAINNET_AUTH.md` operator checklist.

### Changed

### Fixed
- R7.1 fixed reset-password cookie `maxAge: 3600 * 24 * 7` ms (~10 min) typo; now matches login's 24h.

## [26.04] - 2026-04-XX

Baseline import from upstream cln-application fork + SuperScalar additions.
See git history for details prior to the start of this changelog.
