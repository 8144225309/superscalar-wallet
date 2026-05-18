# Soup Wallet SQLite Schema

**Status:** draft for review · 2026-05-18 · author: wallet team

The Soup Wallet's authoritative storage for all server/client coordination state, policy, and wallet-domain features. Companion to `CEREMONY_DESIGN.md` §3 (which defines the lib/wallet line) and the libsuperscalar SQLite schema (which holds crypto + ceremony round bookkeeping only).

## 1. Storage location

Single SQLite file per wallet installation:

```
<app-data>/soupwallet/wallet.db
```

- Linux: `~/.config/soupwallet/wallet.db`
- macOS: `~/Library/Application Support/soupwallet/wallet.db`
- Windows: `%APPDATA%\soupwallet\wallet.db`

WAL mode enabled. Single writer (the wallet daemon process); reads from the TS frontend go through the daemon, not direct DB access.

## 2. What lives here (and what doesn't)

**Yes:**
- The user's view of every factory they participate in (as LSP or client), with their role and display label
- LSP-side join queue (clients asking to join factories the user hosts)
- Client-side outgoing joins (factories the user has asked to join)
- The IID counter (monotonic, for deterministic instance_id derivation)
- The agreed factory policy snapshot from JOIN time (TLV bytes; what the wallet validates ceremonies against)
- LSP operator preferences (auto-rotate cadence, hidden min_clients_to_start, banlist/allowlist entries, force-out timing)
- Client signing preferences (auto-sign rules per factory, allocation thresholds, notification routing)
- Peer-domain data (notes, reputation, custom filters)
- Wallet feature data (custom factory labels, discovery history, fiat rate cache)

**No:**
- Crypto state (channels, tree nodes, signed TXs, revocation secrets) — lives in libsuperscalar SQLite
- In-flight ceremony round state (nonces, partial sigs, participant phases) — libsuperscalar SQLite
- HTLC state, force-close machinery, breach detections — libsuperscalar SQLite
- Wire bytes received — libsuperscalar SQLite (`ceremony_participants` rows)
- UI ephemeral state (theme, last-viewed screen) — wallet TS layer localStorage

The dividing rule from `CEREMONY_DESIGN.md` §3.2: *"if it would still need to exist in a hypothetical factories-without-MuSig universe, it belongs in the wallet. If it only exists because of the cryptographic protocol, it belongs in the lib."*

## 3. Tables

### 3.1 Schema versioning

```sql
CREATE TABLE schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
INSERT INTO schema_version VALUES (1, strftime('%s','now'));
```

Migrations run on wallet daemon startup. Each migration is a single transaction. Failures roll back; daemon refuses to serve RPCs until schema is current.

### 3.2 Factory list (the user's view)

```sql
CREATE TABLE factories (
    factory_instance_id   BLOB PRIMARY KEY,  -- 32 bytes (matches libsuperscalar)
    my_role               INTEGER NOT NULL,  -- 0 = client, 1 = LSP
    display_label         TEXT,              -- user-editable name; null = use truncated iid
    created_at_block      INTEGER NOT NULL,
    joined_at_block       INTEGER,           -- for clients: block at which JOIN_RESPONSE accepted
    state                 INTEGER NOT NULL,  -- mirror of libsuperscalar factory.state for UI
    last_seen_at          INTEGER NOT NULL,  -- unix ts of last update from plugin
    archived              INTEGER NOT NULL DEFAULT 0  -- 1 = user hid it from main view
);
CREATE INDEX idx_factories_role_state ON factories(my_role, state);
```

The plugin's libsuperscalar SQLite has the authoritative crypto data per factory; this table holds the **user-facing** annotations (label, role-tag, archived flag) plus a cached `state` for snappy UI without RPC roundtrips on every list refresh.

### 3.3 LSP-side join queue

When the user is acting as an LSP, this table tracks every JOIN_REQUEST the user's plugin has received for factories the user hosts. Lobby management.

```sql
CREATE TABLE lsp_join_queue (
    factory_instance_id   BLOB NOT NULL,
    client_pubkey         BLOB NOT NULL,    -- 33-byte requester
    request_id            INTEGER NOT NULL, -- 64-bit, random; matches wire request_id
    contribution_sats     INTEGER NOT NULL,
    received_at_block     INTEGER NOT NULL,
    accepted_at_block     INTEGER,          -- nullable; set when LSP accepted
    decided_at_block      INTEGER,          -- block of last status change
    last_seen_block       INTEGER,          -- updated on any wire message from this client
    status                INTEGER NOT NULL, -- 0=PENDING, 1=ACCEPTED, 2=REJECTED, 3=CANCELLED, 4=DEPARTED
    reason                TEXT,             -- free-form, short (<= 64 chars)
    PRIMARY KEY (factory_instance_id, client_pubkey)
);
CREATE INDEX idx_lsp_join_queue_status ON lsp_join_queue(factory_instance_id, status);
```

The plugin writes this via wallet RPC every time a JOIN_REQUEST arrives or status changes. The wallet UI reads it directly for the LSP's lobby view.

### 3.4 Client-side outgoing joins

When the user is acting as a client trying to join factories.

```sql
CREATE TABLE outgoing_joins (
    factory_instance_id   BLOB NOT NULL,
    lsp_pubkey            BLOB NOT NULL,    -- 33-byte LSP we sent JOIN_REQUEST to
    request_id            INTEGER NOT NULL, -- 64-bit, random
    contribution_sats     INTEGER NOT NULL,
    sent_at_block         INTEGER NOT NULL,
    expected_signing_block INTEGER,         -- from JOIN_RESPONSE if accepted
    updated_at_block      INTEGER NOT NULL,
    status                INTEGER NOT NULL, -- 0=SENT, 1=QUEUED, 2=ACCEPTED, 3=REJECTED, 4=CANCELLED, 5=SIGNED
    reason                TEXT,
    PRIMARY KEY (factory_instance_id, lsp_pubkey)
);
CREATE INDEX idx_outgoing_joins_status ON outgoing_joins(status, updated_at_block);
```

### 3.5 IID counter

Single-row table for the monotonic counter used in HSM-derived instance_id generation.

```sql
CREATE TABLE iid_counter (
    counter      INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
INSERT INTO iid_counter VALUES (0, strftime('%s','now'));
```

Incremented atomically every time the wallet asks libsuperscalar's `derive_instance_id_from_hsm()`. Single row by convention; the wallet daemon enforces "always read/write the first row."

### 3.6 Factory policy snapshots

The TLV-encoded policy bytes as agreed at JOIN time for each factory. This is what the wallet validates incoming ceremony requests against.

```sql
CREATE TABLE factory_policy_snapshots (
    factory_instance_id   BLOB PRIMARY KEY,
    policy_schema_version INTEGER NOT NULL,  -- ss_factory_policy_t schema version
    policy_tlv            BLOB NOT NULL,     -- raw TLV bytes from JOIN-time advertisement
    captured_at_block     INTEGER NOT NULL
);
```

Wallet decodes the TLV on demand (via the codec from `superscalar-cln`, which we own); doesn't store decoded fields here because the decoded form might evolve while the wire bytes are authoritative. The block height captures when the user committed.

### 3.7 LSP operator preferences

Per-factory or global LSP-side settings. `factory_instance_id` NULL = global default; non-null = per-factory override.

```sql
CREATE TABLE lsp_operator_prefs (
    factory_instance_id   BLOB,             -- nullable; null = global default
    pref_key              TEXT NOT NULL,
    pref_value            TEXT NOT NULL,    -- JSON-encoded
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (factory_instance_id, pref_key)
);
```

**Reserved keys for v1:**

| Key | Type | Default | Meaning |
|---|---|---|---|
| `auto_rotate_cadence_blocks` | int | 4320 | Fire scheduled rotation every N blocks (matches factory's `rotation_interval_blocks`) |
| `auto_force_out_after_n_misses` | int | 3 | After participant misses N ceremonies, trigger FORCE_OUT |
| `default_min_clients_to_start_override` | int | (factory default) | Operator's hidden minimum, never advertised (per FACTORY_POLICY_V1 §4.7.7) |
| `banlist_entries` | JSON array of hex pubkeys | `[]` | Pubkeys to reject at JOIN time; never advertised |
| `allowlist_entries` | JSON array of hex pubkeys | `[]` | If non-empty, ONLY these pubkeys can join; never advertised |
| `host_factories_max_concurrent` | int | 32 | Operator's global cap on simultaneous active factories |
| `notify_operator_on_join` | bool | true | Trigger operator UI notification on each JOIN_REQUEST |
| `notify_operator_on_breach` | bool | true | Trigger operator UI notification when watchtower fires a penalty broadcast |

The plugin reads these via wallet RPC (`factory-get-operator-pref`) at decision time. Per-factory overrides take precedence over global defaults.

### 3.8 Client signing preferences

Per-factory unattended-signing policy for when the wallet acts as a client.

```sql
CREATE TABLE client_signing_prefs (
    factory_instance_id   BLOB NOT NULL,
    pref_key              TEXT NOT NULL,
    pref_value            TEXT NOT NULL,    -- JSON-encoded
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (factory_instance_id, pref_key)
);
```

**Reserved keys for v1:**

| Key | Type | Default | Meaning |
|---|---|---|---|
| `auto_sign_scheduled_rotations` | bool | true | Sign ROTATE at epoch boundary without UI prompt |
| `auto_sign_tier_b_rollovers` | bool | true | Sign Tier B allocation changes within threshold |
| `max_allocation_change_sats_auto_sign` | u64 | 100000 | Above this, prompt user; below, auto-sign |
| `require_user_confirmation_for_force_out` | bool | true | Always prompt before signing FORCE_OUT (excluding a peer is serious) |
| `auto_sign_initial` | bool | false | Sign INITIAL without UI prompt (first commitment to a factory; default safe = prompt) |
| `notification_method` | enum | `cln_notify` | `none`, `cln_notify`, `webhook` |
| `notification_endpoint` | string | null | Webhook URL or system-notification target |

Per-factory only (no global defaults yet — each factory gets explicit prefs at JOIN time).

### 3.9 Peer notes

User-written notes about specific peer pubkeys.

```sql
CREATE TABLE peer_notes (
    peer_pubkey      BLOB PRIMARY KEY,
    label            TEXT,                  -- short display name
    body             TEXT,                  -- free-form
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);
```

### 3.10 Peer reputation

Per-peer scoring. v1 ships with a single numerical score; future versions may add categorized scores (uptime, fee fairness, response latency, etc.).

```sql
CREATE TABLE peer_reputation (
    peer_pubkey      BLOB PRIMARY KEY,
    score            INTEGER NOT NULL,      -- v1: simple int, range TBD (e.g., -100..+100)
    n_observations   INTEGER NOT NULL,      -- count of distinct events contributing
    last_observed_at INTEGER NOT NULL,
    source           TEXT                   -- 'manual', 'wot-friend', 'auto-uptime', etc.
);
CREATE INDEX idx_peer_reputation_score ON peer_reputation(score DESC);
```

### 3.11 Custom join rules

User-configurable rules the wallet checks before letting the user join a factory (or letting the LSP accept one). Plain key/value form for evolvability.

```sql
CREATE TABLE custom_join_rules (
    rule_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    role             INTEGER NOT NULL,      -- 0 = client-side filter, 1 = LSP-side filter
    rule_type        TEXT NOT NULL,         -- e.g., 'min_reputation', 'require_lsp_pubkey', 'reject_arity'
    rule_value       TEXT NOT NULL,         -- JSON-encoded value
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL
);
```

**Reserved rule types for v1:**

- `min_reputation` (client) — refuse JOIN if LSP reputation < value
- `max_fee_per_tx_sats` (client) — refuse JOIN if factory's `fee_per_tx` > value
- `require_friend_in_factory` (client) — only join if at least one peer in `peer_reputation` has source='wot-friend'
- `reject_lsp_pubkey` (client) — never join factories from this LSP (effectively a personal banlist for client direction)
- `min_participants_required` (LSP) — refuse to start ceremony with fewer than N joiners (in addition to `default_min_clients_to_start_override`)

### 3.12 Discovery history

Track LSPs the user has browsed (via factory-browse-host) so the UI can show recent activity.

```sql
CREATE TABLE discovery_history (
    lsp_pubkey       BLOB NOT NULL,
    factory_count    INTEGER NOT NULL,      -- how many factories the LSP advertised at browse time
    browsed_at_block INTEGER NOT NULL,
    snapshot_tlv     BLOB,                  -- optional: full TLV of FACTORY_INFO_RESPONSE
    PRIMARY KEY (lsp_pubkey, browsed_at_block)
);
```

### 3.13 Fiat rate cache

Cached BTC ↔ fiat rates for UI display. Refreshed periodically; not authoritative.

```sql
CREATE TABLE fiat_rate_cache (
    currency         TEXT PRIMARY KEY,      -- 'USD', 'EUR', etc.
    rate_sat_per_unit INTEGER NOT NULL,     -- e.g., USD per 1 BTC scaled to sats; or sat per USD scaled
    fetched_at       INTEGER NOT NULL,
    source           TEXT                   -- 'coingecko', 'kraken', etc.
);
```

### 3.14 Wallet-global settings

Catch-all KV for wallet-level config the user can edit.

```sql
CREATE TABLE wallet_settings (
    setting_key      TEXT PRIMARY KEY,
    setting_value    TEXT NOT NULL,         -- JSON-encoded
    updated_at       INTEGER NOT NULL
);
```

**Reserved keys for v1:**

- `wallet_role` (enum: `client_only`, `lsp_only`, `both`) — UI hint and default-prefs gate
- `default_browse_lsps` (JSON array of pubkeys) — LSPs to show as suggested browse targets
- `fiat_preference` (string) — `USD`, `EUR`, etc.
- `theme` — could be here OR in localStorage; this version stays here so multi-device sync covers it later
- `auto_join_friend_factories` (bool) — if a peer in `peer_reputation` with source='wot-friend' joins a factory, auto-join too

## 4. Indexes summary

```sql
CREATE INDEX idx_factories_role_state          ON factories(my_role, state);
CREATE INDEX idx_lsp_join_queue_status         ON lsp_join_queue(factory_instance_id, status);
CREATE INDEX idx_outgoing_joins_status         ON outgoing_joins(status, updated_at_block);
CREATE INDEX idx_peer_reputation_score         ON peer_reputation(score DESC);
```

Add others as query patterns surface during integration.

## 5. Query patterns the wallet will commonly run

For each, named the primary key/index that should make it fast.

| Pattern | Primary index |
|---|---|
| List all factories user is in, by role | `idx_factories_role_state` |
| For factory X, who's in the LSP-side join queue? | `lsp_join_queue` PK on `(factory_instance_id, *)` |
| For factory X, what's the agreed policy? | `factory_policy_snapshots` PK |
| For factory X, what are the client signing prefs? | `client_signing_prefs` PK on `(factory_instance_id, *)` |
| What's the next IID counter value? | Single-row read of `iid_counter` |
| Highest-reputation peers | `idx_peer_reputation_score` |
| Filter incoming JOIN_REQUEST: is this pubkey banned? | `lsp_operator_prefs` for `banlist_entries`, parse JSON |
| Validate incoming CEREMONY_START: does parent_ceremony_id match? | (plugin asks lib via persist_get_last_finalized_ceremony) |

## 6. Wallet ↔ Plugin RPC interface (sketch)

The wallet daemon exposes RPCs the plugin calls during real-time signing decisions. Wire-shape design lives in a separate doc; this section just lists the surface.

| Plugin → wallet | When | Wallet returns |
|---|---|---|
| `wallet-ceremony-incoming` | CEREMONY_START arrived; validate against policy | `{"action": "sign" \| "refuse", "refuse_code": ...}` |
| `wallet-ceremony-completed` | CEREMONY_RESULT arrived; record finalization | ack |
| `wallet-join-request-incoming` | LSP-side: JOIN_REQUEST arrived; ask wallet to decide | `{"action": "accept" \| "queue" \| "reject", "reason": ...}` |
| `wallet-needs-iid-counter` | Plugin needs next counter value | `{"counter": N}` (atomic ++ on wallet side) |
| `wallet-get-operator-pref` | Plugin needs a stored operator setting | `{"value": ...}` |
| `wallet-get-signing-pref` | Plugin needs a client signing preference | `{"value": ...}` |
| `wallet-get-policy-snapshot` | Plugin needs the factory policy snapshot for validation | `{"policy_tlv": ...}` |

Plugin RPCs the wallet calls (existing):
- `factory-list` (we provide a wallet-side facade with extra fields)
- `factory-incoming-joins` (mirror of LSP-side queue, but read via plugin)
- `factory-metrics`, `factory-funding-precheck`, all the other operator RPCs

## 7. Implementation choice

Wallet daemon is TypeScript/Node. Recommend `better-sqlite3` — synchronous, fast, well-maintained, handles WAL mode cleanly. Alternatives:

- `node-sqlite3` — async, slightly slower, similar features
- `sql.js` — pure JavaScript; only for environments without native bindings (browser-side)

For this design, `better-sqlite3` on the daemon side. The TS frontend never touches the DB directly; it goes through daemon RPCs.

## 8. Backup and restore

Wallet daemon supports:

- **Export:** dump the DB to a `.sqlite` file the user can copy off-machine. Excludes the IID counter and outgoing_joins to avoid double-spend / replay issues if restored to a fresh node.
- **Import:** restore from a `.sqlite` file. Validates schema_version; refuses if incompatible.
- **Selective export:** only `peer_notes`, `peer_reputation`, `custom_join_rules`, `wallet_settings` — the parts safe to share across wallet installations of the same user.

Backup of crypto state (libsuperscalar SQLite + the HSM seed) is a separate user concern — this wallet DB alone is not enough to recover funds.

## 9. Versioning policy

- Schema changes are migrations in a numbered sequence
- Adding columns: backward-compatible, just an `ALTER TABLE`
- Adding tables: backward-compatible
- Renaming or dropping: requires major-version bump and migration logic for in-place rewrite
- Adding new pref keys to `lsp_operator_prefs` / `client_signing_prefs`: no migration needed (keys are TEXT)

Each migration runs in a transaction. Failures roll back atomically.

## 10. Concurrency

Single-writer model: only the wallet daemon writes to this DB. The TS frontend reads via daemon RPC (no direct DB access). WAL mode permits concurrent reads from other tools (backup utilities, debug tools) without blocking the daemon's writes.

If the user runs multiple wallet installations on the same machine pointed at the same node (unusual but possible), they have separate DB files in separate app-data directories. They'd interoperate at the **plugin** level (both reading libsuperscalar SQLite via plugin RPCs) but not at the wallet-prefs level. That's intentional — different wallet installations are different users from the wallet's perspective.

## 11. Open questions

- **Should `factories.state` be a cache or canonical?** Currently designed as a cache (libsuperscalar holds canonical state). Stale-cache risk vs. RPC roundtrip on every list. Inclined to keep as cache with TTL of 1 block.
- **Should peer_reputation use signed integers or unsigned?** Need to decide range before we cement the column type. Lean signed (-1000..+1000 ish).
- **Should we encrypt the wallet DB at rest?** Currently plaintext SQLite. The HSM-protected secrets aren't in here, but personal peer notes might be sensitive. Defer to future PR.
- **Should `factory_policy_snapshots` cache the decoded form too?** Faster lookups during validation, but two-source-of-truth risk. Inclined to decode-on-demand.

---

End of schema doc.
