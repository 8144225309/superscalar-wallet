# Soupwallet operator runbook

Wallet-side operations only. Anything about factories, MuSig2,
ceremonies, on-chain TXs, or breach-response lives in the plugin /
lib runbooks. This doc covers running the wallet HTTP UI in front of
a CLN node on mainnet.

Companions: [MAINNET_AUTH.md](MAINNET_AUTH.md) (auth posture),
[SEED_BACKUP.md](SEED_BACKUP.md) (seed/backup scope),
[REPO_GOVERNANCE.md](REPO_GOVERNANCE.md) (repo rules).

## Quick reference — env vars

| Var | Default | Mainnet recommendation |
|---|---|---|
| `APP_SINGLE_SIGN_ON` | `false` | `false` (require login) |
| `APP_JWT_SECRET` | ephemeral random | stable 64-byte hex (`openssl rand -hex 64`) — required if you don't want every restart to invalidate sessions |
| `APP_PROTOCOL` | `http` | `https` (with reverse-proxy TLS termination, or run behind nginx/caddy) |
| `APP_HOST` | `localhost` | bind to `127.0.0.1` and reverse-proxy, OR bind public with firewall |
| `APP_PORT` | `2103` | any free port; expose only via reverse proxy |
| `APP_CONFIG_FILE` | `./config.json` | mode 0600, owned by wallet user |
| `APP_LOG_FILE` | `./application-cln.log` | rotate via logrotate |
| `APP_MODE` | `production` | `production` |
| `NODE_ENV` | (unset) | `production` (turns on `Secure` cookie flag) |
| `APP_CONNECT` | `COMMANDO` | match your CLN setup (COMMANDO / REST / GRPC) |
| `LIGHTNING_DATA_DIR` | — | path to CLN's data dir (the wallet reads `lightning-rpc` and certs from here) |
| `BITCOIN_NETWORK` | `bitcoin` | `bitcoin` for mainnet, `testnet4` / `signet` / `regtest` for others |

The complete defaults list lives in `apps/backend/source/shared/consts.ts`
(`DEFAULT_ENV_VALUES`).

## Install

The wallet runs as a Node service. Two supported deployment shapes:

### A. Native (recommended for single-operator mainnet)

```
git clone https://github.com/8144225309/superscalar-wallet
cd superscalar-wallet
npm ci
npm run build
NODE_ENV=production \
  APP_SINGLE_SIGN_ON=false \
  APP_JWT_SECRET="$(openssl rand -hex 64)" \
  APP_HOST=127.0.0.1 \
  APP_PORT=2103 \
  LIGHTNING_DATA_DIR=/var/lib/lightning \
  node apps/backend/dist/server.js
```

Front it with nginx / caddy for TLS. Recommended caddyfile snippet:

```
wallet.example.com {
  reverse_proxy 127.0.0.1:2103
  encode gzip
}
```

### B. Docker

```
docker run --rm -p 2103:2103 \
  -v /var/lib/lightning:/lightning:ro \
  -v /var/lib/soupwallet:/data \
  -e APP_SINGLE_SIGN_ON=false \
  -e APP_JWT_SECRET="..." \
  -e LIGHTNING_DATA_DIR=/lightning \
  -e APP_CONFIG_FILE=/data/config.json \
  -e APP_LOG_FILE=/data/application-cln.log \
  ghcr.io/8144225309/superscalar-wallet:latest
```

(Image publish is tracked separately in R7.7.)

## First-run sequence

1. Start the wallet with `APP_SINGLE_SIGN_ON=false`.
2. Browse to `http://<host>:<port>/`.
3. You'll be prompted to set a password. The frontend pre-hashes
   (sha256) before submitting; the server stores the hash in
   `config.json`.
4. Pick a long password (≥12 chars). The rate limiter only gives an
   attacker 5 attempts per 15 minutes from a single IP, so even
   modest length is functionally unbreakable through the login
   endpoint.
5. Verify the rate limit works: log out, try 6 wrong passwords in a
   row, expect HTTP 429 on the 6th.

## Common operations

### Restart

Standard systemd:

```
sudo systemctl restart soupwallet
```

After restart, all sessions invalidate UNLESS `APP_JWT_SECRET` is
set to a stable value. See [MAINNET_AUTH.md](MAINNET_AUTH.md).

### Reset password

From the UI: `Settings → Reset Password` (requires current password).

If you've lost the password entirely:

```
sudo systemctl stop soupwallet
# Edit config.json: remove the "password" field, or set it to ""
sudo -u soupwallet jq 'del(.password)' /var/lib/soupwallet/config.json > /tmp/config.json
sudo -u soupwallet mv /tmp/config.json /var/lib/soupwallet/config.json
sudo systemctl start soupwallet
# Browse to the UI; you'll be re-prompted to set a new password
```

### View logs

```
sudo journalctl -u soupwallet -f                        # live tail
sudo journalctl -u soupwallet --since "1 hour ago"      # recent
tail -f /var/lib/soupwallet/application-cln.log         # file backend
```

Notable log levels — `info` for routine, `warn` for rate-limit hits
and degraded states, `error` for handlers that returned 5xx.

### Check metrics

```
curl -s -b cookies.txt http://127.0.0.1:2103/v1/shared/metrics/
```

Returns Prometheus text format. Scrape into a TSDB for dashboards.
Available series (wallet-side only):

- `soupwallet_auth_login_total`
- `soupwallet_auth_login_success_total`
- `soupwallet_auth_login_failure_total`
- `soupwallet_auth_rate_limit_hits_total{route=...}`
- `soupwallet_http_5xx_total{status=...}`
- `soupwallet_process_start_time_seconds`

CLN node, plugin, and protocol metrics live in the plugin team's
`factory-metrics` RPC — separate scrape target.

### Backup wallet config

`Settings → Export Config` downloads a JSON envelope. See
[SEED_BACKUP.md](SEED_BACKUP.md) for what the export does and does
NOT include (it does NOT include the seed — that's CLN's
`hsm_secret`).

### Update / upgrade

```
cd /opt/superscalar-wallet
sudo systemctl stop soupwallet
git fetch && git checkout v0.3.0   # or the tag you want
npm ci && npm run build
sudo systemctl start soupwallet
```

If `APP_JWT_SECRET` is stable, sessions survive. If not, everyone
re-logs in.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| 401 on every request after restart | `APP_JWT_SECRET` ephemeral (new one each restart) | set it to a stable value |
| HTTP 429 from /login | rate limiter (5/15min per IP) | wait 15 min, or restart the wallet to clear in-memory state |
| HTTP 401 "Unauthorized user" while singleSignOn=true | env var set incorrectly (e.g. `True` not `true`) | set lowercase `true` |
| Settings dropdown shows no Reset Password | `singleSignOn=true` — auth fully bypassed | flip to `false` for mainnet |
| Login modal accepts password but redirect loops back | `config.json` not writable by wallet user | check file ownership + mode |
| `Wallet Connect` modal blank | `LIGHTNING_DATA_DIR` doesn't contain the expected `lightning-rpc` socket / certs | check path + permissions |
| CSP violation in browser console | new inline script/style introduced; CSP in server.ts blocks | move to external stylesheet/script or extend CSP (see R7.6) |
| `EADDRINUSE` on startup | port already in use by previous instance | `lsof -iTCP:2103` to find the PID; stop systemd cleanly |

## Pre-mainnet checklist (wallet side)

Cross-reference with [MAINNET_AUTH.md](MAINNET_AUTH.md):

- [ ] `APP_SINGLE_SIGN_ON=false`
- [ ] `APP_JWT_SECRET` set to a stable 64-byte hex value
- [ ] `NODE_ENV=production`
- [ ] TLS termination in front of wallet (caddy / nginx)
- [ ] `config.json` mode 0600, owned by wallet user
- [ ] Wallet metrics endpoint reachable from your Prometheus scraper
- [ ] Logs rotating (logrotate or journald limits configured)
- [ ] `Export Config` tested and backup stored in your password manager
- [ ] CLN's `hsm_secret` backed up separately per
      [SEED_BACKUP.md](SEED_BACKUP.md)
- [ ] Branch protection in place on the repo you deploy from
      (see [REPO_GOVERNANCE.md](REPO_GOVERNANCE.md))

## What's NOT covered here

- Factory creation / join / sign workflows — UI-driven; users follow
  the in-UI prompts. Protocol-level runbook lives in the plugin/lib repos.
- CLN node operations (startup, channel management, accept-on-chain,
  watchtower, breach response) — see CLN docs and the plugin team's
  mainnet-runbook.
- Multi-tenant / multi-operator deployments — single-operator by
  design today.
