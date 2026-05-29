# User action audit log

Mainnet wallets need a paper trail. The audit log answers
"who did what, when, from where" for the mutating actions the wallet
UI performs.

## Scope

WALLET-side only. Plugin/lib events are tracked separately (the
plugin has its own structured JSON logger). This log focuses on user-
attributable actions through the wallet HTTP UI.

Events captured today:

- `login_success` — successful password verification
- `login_failure` — bad password or exception
- `logout` — explicit logout
- `password_reset` — successful password change
- `config_export` / `config_import` — wallet UI prefs backup/restore
- `cln_call_factory_create` — POST /cln/call with method=factory-create
- `cln_call_factory_approve` — factory-approve-proposal
- `cln_call_factory_refuse` — factory-refuse-proposal
- `cln_call_factory_rotate` — factory-rotate / factory-open-channels
- `cln_call_factory_close` — factory-close-proposal / factory-force-close
- `cln_call_fundchannel` — fundchannel (open a normal LN channel)
- `cln_call_close` — close (cooperative close)

Read-only CLN calls (`listpeers`, `listfunds`, gossip queries, etc.)
are NOT logged — they're high-volume and not user-attributable to a
specific decision.

## Format

`./audit-log.jsonl` (or `$APP_AUDIT_LOG_FILE`). One JSON object per
line:

```json
{"ts":"2026-05-29T22:30:01.123Z","ip":"203.0.113.7","ua":"Mozilla/5.0...","event":"login_success"}
{"ts":"2026-05-29T22:30:14.987Z","ip":"203.0.113.7","ua":"Mozilla/5.0...","event":"cln_call_factory_approve","details":{"method":"factory-approve-proposal"}}
```

Fields:
- `ts` — ISO-8601 with milliseconds, UTC
- `ip` — best-effort source IP (honors `trust proxy` if set)
- `ua` — user-agent, truncated to 200 chars
- `event` — one of the names above
- `details` — optional small object; never contains passwords, tokens,
  or other secrets

## Querying

### From the wallet API

```
GET /v1/shared/audit-log?limit=200
```

(auth-gated). Returns the last `limit` entries (capped at 1000).
JSON shape: `{ "entries": [ { ts, ip, ua, event, details? }, ... ] }`.

### From the host

```
# last 50 events
tail -n 50 audit-log.jsonl

# all failed logins in the last hour
jq -c 'select(.event == "login_failure" and (.ts | fromdateiso8601) > (now - 3600))' audit-log.jsonl

# every mutating CLN call by IP
jq -c 'select(.event | startswith("cln_call_")) | {ts, ip, event}' audit-log.jsonl
```

## Rotation

The log is append-only and unbounded. For production:

```
# /etc/logrotate.d/soupwallet-audit
/var/lib/soupwallet/audit-log.jsonl {
  weekly
  rotate 8
  compress
  missingok
  copytruncate
}
```

`copytruncate` is preferred over `create` because the wallet uses
`appendFileSync` and won't notice if the file inode changes.

## Privacy

The log includes source IP. If the wallet is exposed behind a reverse
proxy and you want only the proxy IP recorded, unset `trust proxy`
in `server.ts`. The default is `trust proxy: true` so the real
client IP from `X-Forwarded-For` is captured.

User-agent is captured for forensics (helps distinguish "operator
laptop" from "automation hitting the API"). If this is undesired,
patch `safeUA()` in `audit-log.ts` to return `''`.

## Failure behavior

`appendFileSync` errors are logged to the regular log and the request
continues normally. Audit logging must never break a working request
— a corrupt or full-disk audit file should not deny a legitimate
operator the ability to act. The trade-off is that a determined
attacker who can fill disk could mask their actions; the regular log
will still show the write failures.

## What's NOT here

- Append signing / hash chaining — the file is plain JSON lines.
  Tampering is detectable only by external snapshot/checksum. Add
  signed-append later if the threat model includes a hostile root
  on the wallet host.
- Centralized shipping — operators with multiple wallets should ship
  to a SIEM (`vector`, `fluentbit`, etc.). The JSONL format is
  designed for this.
- Per-event verbosity flags — every mapped event is always logged.
  Filter at query time (jq) rather than at write time.
