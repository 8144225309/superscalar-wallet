# Mainnet auth posture

The wallet's HTTP UI sits in front of CLN, which holds the actual node
keys. UI auth gates whether someone with network access to the wallet's
port can trigger actions (create factory, approve join, configure auto-sign,
read balances). It does NOT gate the on-chain MuSig2 ceremony keys —
those are in CLN's HSM regardless.

This document is the operator checklist for running the wallet on
mainnet without inviting trivial compromise.

## Mode selector: `APP_SINGLE_SIGN_ON`

- **`APP_SINGLE_SIGN_ON=true`** (demo / regtest convenience): every
  request is treated as authenticated. No login screen, no cookie
  check. Safe ONLY when the port binds to localhost AND only trusted
  users have shell access to the host.
- **`APP_SINGLE_SIGN_ON=false`** (mainnet): the wallet requires a
  password set at first run, JWT cookie on each request, rate-limited
  login. This is the required posture for any wallet whose port is
  reachable from outside `127.0.0.1`.

The wallet ships with `APP_SINGLE_SIGN_ON=false` as the default in
`shared/consts.ts`. The demo deploy overrides it via env var.

## JWT signing secret: `APP_JWT_SECRET`

The wallet signs session cookies with HS256. The secret comes from
`process.env.APP_JWT_SECRET` if set, otherwise a process-ephemeral
random 64-byte hex string.

**Ephemeral mode** (env unset): every server restart re-rolls the
secret. All existing sessions invalidate. Secure but disruptive — an
operator who restarts the daemon for a routine upgrade will have to
re-login from every device. Fine for low-restart deployments.

**Stable mode** (env set): the secret persists across restarts.
Sessions survive deploys. Required if you operate the wallet from
multiple devices and don't want each restart to log everyone out.

Generate a stable secret:
```
openssl rand -hex 64
```
and pass it via systemd unit, docker env, etc. Treat it as a credential
— a leaked `APP_JWT_SECRET` lets an attacker forge session cookies
without knowing the password.

## Rate limits

Defined in `shared/auth-rate-limit.ts`. Applied per source IP.

| Route | Window | Limit | After |
|---|---|---|---|
| `POST /v1/auth/login/` | 15 min | 5 failed attempts | 15 min lockout for that IP |
| `POST /v1/auth/reset/` | 1 hour | 3 attempts | 1 hour lockout |

Successful logins don't count against the limit so a legitimate
operator who fat-fingers a password isn't punished for getting it
right on the 6th try.

**Multi-instance deployments**: the limiter uses in-memory state.
Behind a load balancer, replace `MemoryStore` with a Redis store —
see `express-rate-limit` docs for the `store` option.

## Cookie flags

- `httpOnly: true` — client JS can't read the token (XSS hardening)
- `secure: true` when `NODE_ENV=production` — cookie only transmitted
  over HTTPS. Combine with a real TLS cert in front of the wallet on
  mainnet.
- `sameSite: 'strict'` — token only sent on same-origin requests,
  blocks CSRF on auth-protected endpoints
- `maxAge: 24h` — session expires after a day; user re-logs in.

## Password storage

The frontend pre-hashes (sha256) before submitting; the server stores
the hash in `config.json` and compares hashes on login. The hash is
unsalted — a leaked `config.json` is vulnerable to rainbow tables for
common passwords. **Mitigations:**
- File-system protect `config.json` (mode 0600, owned by the wallet
  user — never world-readable)
- Pick a long password (the rate limit gives you `5 attempts / 15 min`
  of guess budget; even a 12-char password is functionally
  unbreakable through the login endpoint)
- A switch to salted bcrypt/argon2 is a follow-up item — tracked
  separately because it needs a config-migration story

## Pre-mainnet checklist

Before exposing the wallet HTTP port outside `127.0.0.1`:

1. `APP_SINGLE_SIGN_ON=false`
2. `APP_JWT_SECRET` set to a stable 64-byte hex value
3. `NODE_ENV=production`
4. TLS termination in front of the wallet (nginx, caddy, or similar)
5. `config.json` permissions 0600
6. First-run: set a real password via the UI's password modal
7. Verify rate limits work: hit `/v1/auth/login/` 6 times with a wrong
   password, expect HTTP 429 on the 6th

## What's deliberately NOT here

- **2FA / TOTP** — no audience asking for it yet; would gate on UI work
- **Recovery codes** — same as above
- **OAuth / SSO via external IdP** — same
- **Per-user accounts** — the wallet is single-operator by design
- **Session list / revocation** — only one session per device at a
  time; logout invalidates locally
