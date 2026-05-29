# SuperScalar stack — repo + role map

Five repositories compose a running SuperScalar deployment. This doc
exists to help operators (and reviewers) navigate the stack without
having to reverse-engineer the layout.

This wallet is **one** repo in that stack — the UI / RPC frontend for
a CLN node. It does not hold keys, does not do crypto, does not parse
wire messages directly.

## The five repos

| # | Repo | Role | Owner |
|---|---|---|---|
| 1 | `libsuperscalar` | C library: factory tree math, MuSig2 ceremonies (BIP-327), burn/rotation TX construction | lib team |
| 2 | `superscalar-cln` | CLN plugin: bLIP-56 wire handling, RPC surface, state machine, SQLite persistence | plugin team |
| 3 | `superscalar-wallet` (this repo) | Web UI + Node backend in front of a CLN node | wallet team |
| 4 | `superscalar-watchtower` | Chain watcher: monitors for stale-epoch broadcasts, publishes punishment TXs during breach window | watchtower team |
| 5 | `superscalar-rendezvous` | Nostr-based LSP discovery + invite-link service | rendezvous team |

A mainnet node operator typically runs (1)+(2)+(3)+(4) on the same
host. (5) is shared infrastructure across operators.

## Data flow at a glance

```
Browser
  │ HTTPS
  ▼
soupwallet UI (this repo, apps/frontend)
  │ HTTP /v1/* + WebSocket
  ▼
soupwallet backend (this repo, apps/backend)
  │ Commando RPC over Unix socket / REST / gRPC
  ▼
lightningd (Core Lightning)
  │ plugin protocol
  ▼
superscalar-cln plugin
  │ ── factory_*, wallet_* RPCs ──┐
  │                               ▼
  │                       ss_db.sqlite3 (crypto)
  │                       wallet_db.sqlite3 (coordination)
  │
  │ uses
  ▼
libsuperscalar (C, in-process inside plugin)
```

Chain side:

```
bitcoind
  ▲
  │ ZMQ / RPC
  │
superscalar-watchtower
  │ monitors factory UTXOs
  │ broadcasts punishment TXs during breach window
  │
  │ reads breach window state from
  ▼
superscalar-cln plugin (via shared SQLite or watchtower-specific RPC)
```

Discovery side:

```
operator browser
  │
  ▼
superscalar-wallet (Connect / Invite UI)
  │ NIP-01 over WebSocket
  ▼
Nostr relays (operator-configured: nos.lol, relay.damus.io, …)
  ▲
  │ NIP-01
  │
superscalar-rendezvous (LSP advertise + browse)
```

## Where each concern lives

| Concern | Repo | Notes |
|---|---|---|
| Channel key custody | CLN's `hsm_secret` | NEVER in this wallet. See [SEED_BACKUP.md](SEED_BACKUP.md). |
| Factory MuSig2 ceremony state | superscalar-cln (in-process via lib) | Plugin owns the FSM. Wallet sees lifecycle strings only. |
| bLIP-56 wire parsing | superscalar-cln | Plugin handles 0x0140-0x014C. |
| Factory leaf math | libsuperscalar | DW tree, PS-Spilman leaf TX construction. |
| Pre-sign policy check | superscalar-cln (authoritative) + wallet TS mirror | See [policy-validator.ts](../apps/frontend/src/utilities/policy-validator.ts). |
| Operator UI for join review | superscalar-wallet (this repo) | LspOperatorConsole + JoinRequestsCard. |
| Auto-sign decision | superscalar-cln | Plugin runs validator. Wallet toggle just persists the pref. |
| Audit trail (wallet actions) | superscalar-wallet | [AUDIT_LOG.md](AUDIT_LOG.md). |
| Audit trail (plugin events) | superscalar-cln | Plugin's structured JSON log. |
| Breach response | superscalar-watchtower | Wallet doesn't watch chain. |
| LSP discovery / invite links | superscalar-rendezvous + soupwallet's Connect UI | |
| Backup of CLN state | CLN-side (`hsm_secret`, channel DB) | See [SEED_BACKUP.md](SEED_BACKUP.md). |
| Backup of wallet UI prefs | superscalar-wallet (this repo) | `Settings → Export Config`. |

## Repo cross-references

Whenever you find yourself wanting to fix a "wallet" bug that's
actually about ceremony state, wire parsing, or chain watching: it
probably belongs upstream.

| Symptom | Where to look |
|---|---|
| Ceremony never completes | plugin logs (factory_state_machine), then lib (musig2 step) |
| Factory shows wrong lifecycle in UI | plugin's lifecycle string mapping, then wallet's bucketing in [factoryStatus.ts](../apps/frontend/src/utilities/factoryStatus.ts) |
| Pre-sign validator pass/fail mismatch with TS mirror | wallet's [policy-validator.ts](../apps/frontend/src/utilities/policy-validator.ts) — plugin wins; mirror has a bug |
| Breach window expired with no punishment TX | watchtower, NOT wallet |
| Invite link doesn't decode | rendezvous repo or wallet's invite-modal parser |
| `factory-browse-host` hangs | plugin |
| Wallet UI freezes during MuSig2 | wallet (frontend perf) — UI shouldn't block on ceremony |

## bLIP-56 PR + reference docs

- bLIP-56 PR: https://github.com/lightning/blips/pull/56
- Lib / plugin design canon: see the SuperScalar docs site (linked
  from the lib repo's README)
- Plugin's own CONFORMANCE: `superscalar-cln/CONFORMANCE.md` — tracks
  protocol-level deviations
- Wallet's CONFORMANCE: [CONFORMANCE.md](CONFORMANCE.md) — tracks
  UI-level deviations (this file's sibling)

## What's NOT here

- Detailed lib API — see lib repo's header files
- Plugin RPC reference — see `superscalar-cln/docs/RPC.md` (plugin's
  own canonical reference)
- bLIP-56 wire format — see the BLIP PR
