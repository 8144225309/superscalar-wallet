# SuperScalar Adapter Protocol Specification v1

**Status:** Draft (2026-05-16)
**Schema version:** 1
**Audience:** SuperScalar lib developers, superscalar-cln plugin developers, superscalar-wallet developers
**Intended destination:** `superscalar-docs/deep-dives/protocol.md` once aligned, plus a normative copy in `8144225309/superscalar-cln/PROTOCOL.md`

---

## 1. Purpose

This document is the single source of truth for **the commands and messages that flow between the three software layers** in the SuperScalar stack:

```
   ┌─────────────────┐    JSON over   ┌─────────────────┐    BOLT-8 wire    ┌─────────────────┐
   │ superscalar-    │    HTTPS       │  CLN node       │    custommsg      │  CLN node       │
   │ wallet          │  ────────────► │  + plugin       │  ───────────────► │  + plugin       │
   │ (TS UI)         │                │  (LSP host)     │                   │  (other host)   │
   └─────────────────┘                └─────────────────┘                   └─────────────────┘
            │                                  │
            │ Nostr (NIP-44 DMs +              │
            │ kind-38101 vouches)              │ JSON-RPC over Unix socket
            ▼                                  ▼
   ┌─────────────────┐                ┌─────────────────┐
   │ soup-rendezvous │                │ superscalar     │
   │ coordinator     │                │ C library       │
   └─────────────────┘                └─────────────────┘
```

bLIP-56 itself defines only the **substrate** — the wire-message-type slot, the feature-bit handshake, and the envelope format for protocol-specific payloads. The application protocol that rides on top — how participants discover factories, how a client requests to join, how MuSig2 ceremonies progress — is left to the implementation. This doc is that application protocol.

---

## 2. Scope and non-goals

### In scope

- The plugin's JSON-RPC surface: every `factory-*` command the wallet may call.
- The plugin's BOLT-8 wire surface: every `SS_SUBMSG_*` type the plugin sends/receives.
- The wallet's Nostr event surface: every kind-* event and DM the wallet publishes/subscribes to.
- The mapping between user actions in the wallet UI and the RPCs / wire messages that result.
- Identification of **gaps** — actions the user can take in the UI today that have no functioning end-to-end path.

### Not in scope

- The internal data model of the SuperScalar lib — see `8144225309/SuperScalar/include/superscalar.h`.
- The cryptographic correctness of MuSig2, Decker-Wattenhofer, or Pseudo-Spilman — see [delvingbitcoin.org/superscalar](https://delvingbitcoin.org).
- bLIP-56's substrate itself — see `superscalar-cln/CONFORMANCE.md` for the deviation log against the draft.
- Factory **policy** (M, fee, L, R, lifetimes, etc.) — see `docs/FACTORY_POLICY_V1.md`. Policy values *travel through* this protocol but are specified separately.
- Coordinator-side internals (proof verification, vouch issuance logic) — see `soup-rendezvous`.

---

## 3. Layer 1 — Wallet ↔ Plugin (JSON-RPC over CLN)

### 3.1 Transport

- **Primary:** lnmessage commando over BOLT-8 noise WebSocket, addressed to the CLN node's commando rune.
- **Fallback:** Direct Unix-socket JSON-RPC against `lightning-rpc` on the same host as the wallet backend. Used for backend-only operations (e.g. `signmessage` for the vouch flow) and as a development convenience when commando is not configured.

### 3.2 Plugin-registered commands

The complete list of `factory-*` RPCs the plugin registers today (from `superscalar.c` `commands[]`):

| Command | Direction | Caller | Status in wallet |
|---|---|---|---|
| `factory-create` | wallet → plugin | LSP operator | ✓ wired (`http.service.ts:612`) |
| `factory-list` | wallet → plugin | LSP operator | ✓ wired (`:593`) |
| `factory-metrics` | wallet → plugin | LSP operator | ○ not used |
| `factory-rotate` | wallet → plugin | LSP operator | ✓ wired (`:616`) |
| `factory-close` | wallet → plugin | LSP operator | ✓ wired (`:620`) |
| `factory-force-close` | wallet → plugin | LSP operator | ✓ wired (`:624`) |
| `factory-ps-advance` | wallet → plugin | LSP operator | ○ not used |
| `factory-check-breach` | wallet → plugin | LSP operator | ✓ wired (`:628`) |
| `factory-open-channels` | wallet → plugin | LSP operator | ✓ wired (`:634`) |
| `factory-ladder-status` | wallet → plugin | LSP operator | ○ not used |
| `factory-initiate-exit` | wallet → plugin | client | ○ not used |
| `factory-buy-liquidity` | wallet → plugin | client | ○ not used |
| `factory-migrate` | wallet → plugin | client | ○ not used |
| `factory-migrate-complete` | wallet → plugin | client | ○ not used |
| `factory-close-departed` | wallet → plugin | LSP operator | ○ not used |
| `factory-confirm-closed` | wallet → plugin | LSP/client | ○ not used |
| `factory-scan-external-close` | wallet → plugin | LSP/client | ○ not used |
| `factory-reorg-check` | wallet → plugin | LSP operator | ○ not used |
| `factory-source-check` | wallet → plugin | LSP operator | ○ not used |
| `factory-abort-stuck` | wallet → plugin | LSP operator | ○ not used |
| `dev-factory-*` (16 commands) | wallet → plugin | testing | ○ excluded from production UI |

### 3.3 Plugin notifications & hooks (incoming to plugin from CLN)

| Hook | Purpose | Wallet visibility |
|---|---|---|
| `block_added` | Drives breach scans, expiry checks, CPFP scheduling | none (plugin-internal) |
| `connect` peer-notification | Triggers `supported_factory_protocols` exchange | none (plugin-internal) |
| `custommsg` hook | Receives 33001 wire traffic, dispatches to ceremony state machine | none (plugin-internal) |
| `htlc_accepted` hook | Reroutes factory-sub-channel HTLCs to alias scids | none (plugin-internal) |
| `openchannel` hook | Sets `minimum_depth=0` for factory channels | none (plugin-internal) |

The wallet has no direct subscribe-to-plugin-notification API today — all wallet-visible state comes from RPC polling or `setupclnsubscriptions` on standard CLN events. See [Gap-1](#7-gaps) for the ceremony progress polling design.

### 3.4 RPCs missing for the bLIP-56 join flow

The user observed (2026-05-16): *"so currently the join button does nothing right?"* — correct. The plugin's RPC surface today is **host-side only**. There is no:

- **`factory-browse-host`** — query another host's plugin for its live factory list. Today `factory-list` returns the calling node's own factories only.
- **`factory-join-request`** — signal to another host that this node wants to be admitted to a specific factory.
- **`factory-ceremony-status`** — poll the local plugin for "what state is ceremony X in" so the UI can render progress.

These are addressed in §7.

---

## 4. Layer 2 — Plugin ↔ Plugin (BOLT-8 custommsg)

### 4.1 Transport

- **Wire-type:** ODD **33001** (deviation from bLIP-56 draft's EVEN 32800 — rationale in `superscalar-cln/CONFORMANCE.md` §"Deviation: ODD 33001 instead of EVEN 32800").
- **Feature-bit gating:** Every message is sent only between peers that have mutually advertised bit **270/271** (`pluggable_channel_factories`) in `init` / `node_announcement`.
- **Envelope:** Every 33001 payload begins with a `factory_submessage_id` (u16) that selects the bLIP-56 generic handler or, for `factory_piggyback`, descends into a protocol-specific payload keyed by `factory_protocol_id`.

### 4.2 bLIP-56 generic submessages (cross-protocol)

Defined by the bLIP-56 draft, implemented in the plugin's `dispatch_blip56_submsg()`:

| Submsg ID | Name | Direction | Purpose |
|---|---|---|---|
| `0x0002` | `supported_factory_protocols` | both | Handshake — TLV 512 lists `factory_protocol_id`s the sender supports |
| `0x0004` | `factory_piggyback` | both | Opaque wrapper carrying `(factory_protocol_id, payload)` for the protocol-specific dispatcher below |
| `0x0006` | `factory_change_init` | initiator → responder | STFU-gated rotation kickoff |
| `0x0008` | `factory_change_ack` | responder → initiator | Rotation ack |
| `0x000A` | `factory_change_funding` | both | New funding txid exchange (factory-channel-rotation specific) |
| `0x000C` | `factory_change_continue` | initiator → responder | Resume from STFU after new state is valid |

### 4.3 SuperScalar protocol submessages (inside `factory_piggyback`)

`factory_protocol_id = ASCII("SuperScalar/v1")` zero-padded to 32 bytes. Dispatched in the plugin's `dispatch_superscalar_submsg()`.

Sourced from `superscalar-cln/ceremony.h`:

**Factory creation ceremony (3-round MuSig2 N-of-N + distribution tx):**

| Submsg ID | Name | Direction | Role in ceremony |
|---|---|---|---|
| `0x0100` | `FACTORY_PROPOSE` | LSP → clients | Tree params, funding outpoint, LSP nonces |
| `0x0101` | `NONCE_BUNDLE` | client → LSP | Per-signer nonce set |
| `0x0102` | `ALL_NONCES` | LSP → clients | Aggregated nonces broadcast |
| `0x0103` | `PSIG_BUNDLE` | client → LSP | Per-signer partial sig set |
| `0x0104` | `FACTORY_READY` | LSP → clients | Final aggregated tree + channel params |
| `0x010D` | `DIST_PROPOSE` | LSP → clients | Distribution-tx params |
| `0x010E` | `DIST_NONCE` | client → LSP | Distribution-tx nonces |
| `0x010F` | `DIST_ALL_NONCES` | LSP → clients | Aggregated distribution-tx nonces |
| `0x0115` | `DIST_PSIG` | client → LSP | Distribution-tx partial sigs |
| `0x0133` | `DIST_READY` | LSP → clients | Aggregated signed distribution tx (for `dist_signed_tx` storage) |

**Epoch rotation ceremony:**

| Submsg ID | Name | Direction | Role |
|---|---|---|---|
| `0x0108` | `ROTATE_PROPOSE` | LSP → clients | New epoch params |
| `0x0109` | `ROTATE_NONCE` | client → LSP | Round-1 nonces |
| `0x010A` | `ROTATE_PSIG` | client → LSP | Round-2 partial sigs |
| `0x010B` | `ROTATE_COMPLETE` | LSP → clients | New epoch signed |
| `0x010C` | `REVOKE` | LSP → clients | Prev-epoch revocation secret |
| `0x0116` | `REVOKE_ACK` | client → LSP | Durable receipt of revocation. LSP refuses next REVOKE until acked. Payload: epoch (u32 BE). |

**Cooperative close ceremony:**

| Submsg ID | Name | Direction | Role |
|---|---|---|---|
| `0x0110` | `CLOSE_PROPOSE` | LSP → clients | Close kickoff |
| `0x0111` | `CLOSE_NONCE` | client → LSP | Close nonces |
| `0x0112` | `CLOSE_ALL_NONCES` | LSP → clients | Aggregated close nonces |
| `0x0113` | `CLOSE_PSIG` | client → LSP | Close partial sigs |
| `0x0114` | `CLOSE_DONE` | LSP → clients | Final close tx |

**Per-leaf advance (2-of-2 DW-arity-1 or PS chain append):**

| Submsg ID | Name | Direction | Role |
|---|---|---|---|
| `0x0130` | `LEAF_ADVANCE_PROPOSE` | LSP → client | leaf_side + LSP pubnonce |
| `0x0131` | `LEAF_ADVANCE_PSIG` | client → LSP | client pubnonce + partial sig |
| `0x0132` | `LEAF_ADVANCE_DONE` | LSP → all clients | leaf_side notification |

**Per-leaf realloc 2-of-2 (value transfer, no chain advance):**

| Submsg ID | Name | Direction | Role |
|---|---|---|---|
| `0x0134` | `LEAF_REALLOC_PROPOSE` | LSP → client | New amounts + LSP pubnonce |
| `0x0135` | `LEAF_REALLOC_PSIG` | client → LSP | client pubnonce + partial sig |
| `0x0136` | `LEAF_REALLOC_DONE` | LSP → all clients | Realloc applied notification |

**Per-leaf realloc 3-of-3 (ARITY_2 leaves: LSP + 2 clients):**

| Submsg ID | Name | Direction | Role |
|---|---|---|---|
| `0x0134` | `LEAF_REALLOC_PROPOSE` | LSP → both clients | Reused — branch by `leaf->n_signers` |
| `0x0137` | `LEAF_REALLOC_NONCE` | each client → LSP | Own pubnonce |
| `0x0138` | `LEAF_REALLOC_ALL_NONCES` | LSP → both clients | All 3 pubnonces in slot order |
| `0x0139` | `LEAF_REALLOC_PSIG_3` | each client → LSP | Own pubnonce + own psig |
| `0x013A` | `LEAF_REALLOC_DONE_3` | LSP → all clients | LSP psig + both client psigs |

**Key turnover (assisted exit via PTLC / direct key handover):**

| Submsg ID | Name | Direction | Role |
|---|---|---|---|
| `0x0120` | `TURNOVER_REQUEST` | client → LSP | Request key turnover |
| `0x0121` | `TURNOVER_KEY` | LSP → client | Released key material |
| `0x0122` | `TURNOVER_ACK` | client → LSP | Receipt |

### 4.4 Ceremony state machine

`ceremony_state_t` in the plugin enumerates: `IDLE`, `PROPOSED`, `FUNDING_PENDING`, `NONCES_COLLECTED`, `PSIGS_COLLECTED`, `COMPLETE`, `FAILED`, `ROTATING`, `ROTATE_COMPLETE`, `REVOKED`. These are plugin-internal today — the wallet has no way to read them. See [Gap-1](#7-gaps).

### 4.5 Wire submessages missing for the bLIP-56 join flow

The submessages above all assume **the LSP has already chosen its clients**. There is no submsg that lets a third-party client *discover* that a host is running a factory and *request* to be included. Specifically:

- **`SS_SUBMSG_FACTORY_INFO_REQUEST`** (proposed `0x0006X`) — "tell me what factories you currently run, with policy summaries"
- **`SS_SUBMSG_FACTORY_INFO_RESPONSE`** — list of `(instance_id, policy_summary, slots_open, slots_total, expiry_block, lifecycle)` tuples
- **`SS_SUBMSG_JOIN_REQUEST`** — "I want to join factory `instance_id` with these proposed params"
- **`SS_SUBMSG_JOIN_RESPONSE`** — `accepted` (with placement details), `queued` (with ladder position), or `rejected` (with reason)

These are addressed in §7.

---

## 5. Layer 3 — Wallet ↔ Coordinator (Nostr)

### 5.1 Transport

- **Relays:** User-configured per-network, defaults baked into `RendezvousSettingsService`. Currently used: `nos.lol`, `relay.damus.io`, `relay.nostr.band`, `nostr.wine`.
- **Encryption:** NIP-44 for wallet→coordinator DMs. kind-38101 vouches are public addressable events (replaceable, `d`-tag = host's Nostr pubkey).
- **Substrate:** `nostr-tools` SimplePool in the frontend; backend uses `LspNostrIdentityService` for signing.

### 5.2 Events the wallet publishes

| Event | Kind | Encryption | Direction | Purpose | Status |
|---|---|---|---|---|---|
| `proof_advertise` DM | 14 (giftwrapped to coord npub) | NIP-44 | wallet → coordinator | LSP asks to be vouched for. Payload: `ln_node_id`, optional channel proof, optional UTXO proof, optional peer proof. | ✓ wired |
| `vouch_revoke` DM | 14 | NIP-44 | wallet → coordinator | LSP retires a vouch. | – not yet |

### 5.3 Events the wallet subscribes to

| Event | Kind | Filter | Direction | Purpose | Status |
|---|---|---|---|---|---|
| `host_vouch` | 38101 (replaceable, `d`-tag = host_pubkey) | `authors`: enabled coordinator pubkeys for the active network | coordinator → world | Coordinator attests a host's tier (channel/utxo/peer) and ln_node_id is reachable. | ✓ wired |
| `factory_announce` | 38102 (replaceable, `d`-tag = `host_pubkey:instance_id`) | proposed | host → world | Per-factory advertisement — policy summary, slots, lifecycle. **Alternative to plugin↔plugin browse.** | – proposed, see §7 |

### 5.4 Events the coordinator publishes (informational, wallet only consumes)

| Event | Kind | Purpose |
|---|---|---|
| `host_vouch` | 38101 | See above |
| `coordinator_info` | proposed (TBD) | Coordinator-published metadata: supported networks, fee schedule, rate limits, contact |

---

## 6. End-to-end user flows

### 6.1 Host a factory (working today)

1. User opens **Host Factory** dialog in wallet (`FactoryCreate.tsx`)
2. User picks `N`, `L`, `R`, wide-leaf preference, fee, lifetime preset
3. Wallet → backend `POST /v1/rendezvous/prepare-vouch-event`
4. Backend builds NIP-44-encrypted `proof_advertise` DM, signs with LSP Nostr identity
5. Frontend publishes signed DM to enabled relays via SimplePool
6. Coordinator receives DM, verifies proof tier, publishes kind-38101 vouch
7. Wallet's ConnectList re-queries, displays the new vouch alongside others
8. *(Out of scope for "advertise" — no actual factory created on chain yet; `factory-create` plugin RPC is a separate user action)*

### 6.2 Browse and join a factory (NOT working today)

The full target flow:

1. User opens **Connect** tab — sees list of vouched hosts (✓ works)
2. User clicks a host row — wants to see *what factories* that host is offering
3. Wallet → backend `POST /v1/rendezvous/browse-host` with target `ln_node_id`
4. Backend → own plugin RPC `factory-browse-host` *(does not exist yet)*
5. Plugin sends `SS_SUBMSG_FACTORY_INFO_REQUEST` to target host via CLN custommsg *(does not exist yet)*
6. Target plugin responds with `SS_SUBMSG_FACTORY_INFO_RESPONSE` containing factory list *(does not exist yet)*
7. Backend returns factory list to frontend
8. Frontend renders factory list under selected host
9. User clicks **Join Factory** button (currently does nothing — sets local React state only)
10. Wallet → backend `POST /v1/rendezvous/join-host` with target + factory_instance_id + proposed params
11. Backend → own plugin RPC `factory-join-request` *(does not exist yet)*
12. Plugin sends `SS_SUBMSG_JOIN_REQUEST` *(does not exist yet)*
13. Target plugin responds `accepted` / `queued` / `rejected` *(does not exist yet)*
14. Wallet displays request status, polls until ceremony triggers
15. When LSP starts ceremony, target plugin sends `SS_SUBMSG_FACTORY_PROPOSE` — this is the existing ceremony entry point (✓ ceremony machinery exists)
16. Wallet polls `factory-ceremony-status` *(does not exist yet)* to render progress

### 6.3 Ceremony progress UI (NOT working today)

Once a factory is forming or rotating, the wallet has no way to render state. Three options below in §7.

---

## 7. Gaps

The gaps are concrete, scoped, and ordered by what unblocks visible UX.

### Gap-1: Ceremony progress visibility

**Symptom:** Wallet has no way to know whether ceremony X is at "nonces collected" or "psigs collected" — `ceremony_state_t` is plugin-internal.

**Three options:**

| Option | Approach | Effort | Pros | Cons |
|---|---|---|---|---|
| A | New plugin RPC `factory-ceremony-status` that returns the current state for a given instance_id. Wallet polls. | small (~1 day plugin, ~1 day wallet) | Simple, matches existing RPC patterns. | Polling latency — user sees state changes 1–N seconds late. |
| B | Plugin emits a CLN notification `superscalar_ceremony_state` on every transition; wallet subscribes via standard CLN notification subscription. | medium (~2 days plugin, ~1 day wallet) | Real-time. No polling overhead. | Needs new plugin notification registration; wallet needs to handle disconnect/reconnect. |
| C | Plugin writes state into CLN's `listdatastore` keyed by `superscalar/ceremony/<id>`; wallet reads via standard `listdatastore` RPC. | medium (~2 days plugin, ~half day wallet) | Persists across plugin restarts; wallet uses existing datastore plumbing. | Polling latency same as A; datastore is not the natural fit for transient state. |

**Recommendation:** A first (cheapest, gets us a working UI), B as an upgrade if polling latency becomes a UX problem.

### Gap-2: Factory browse — third-party discovery

**Symptom:** Clicking a vouched host shows no factories — the wallet can't ask the host "what are you offering?"

**Two architectural choices:**

| Option | Approach | Effort | Pros | Cons |
|---|---|---|---|---|
| α | **Wire-level** — add `SS_SUBMSG_FACTORY_INFO_REQUEST` / `SS_SUBMSG_FACTORY_INFO_RESPONSE` submsgs (per `FACTORY_POLICY_V1.md` §2 already-proposed pair). Wallet's plugin sends the request to target peer, target plugin responds. New wallet RPC `factory-browse-host`. | medium (~3 days plugin both sides, ~1 day wallet) | Authoritative — answer comes from the host itself in real time. Privacy: only known peers see your factory list. Natural fit for join flow. | Requires plugin↔plugin custommsg routing through CLN — adds wire surface area. Browsing requires a 33001-capable peer connection (won't work for offline hosts). |
| β | **Nostr-level** — host plugin publishes kind-38102 `factory_announce` events to coordinator relays, one per active factory. Wallet reads via SimplePool, same plumbing as kind-38101 vouches. | small (~2 days plugin, ~1 day wallet) | No new wire surface. Works for offline hosts (last-known state survives in relays). Hosts naturally rate-limit by publish frequency. | Hosts must trust coordinator's relay set; stale data if not republished; less authoritative (signed by host, but no liveness signal). |

**Recommendation:** β first for the visible UX win (shows users *something* in the Connect panel within a small wallet PR), α as a follow-up for live capacity / per-request privacy if Nostr-broadcast is too coarse. The two are not mutually exclusive — wallet can prefer fresh α data and fall back to β cache.

### Gap-3: Factory join request

**Symptom:** "Join Factory" button only updates local React state — no signal reaches the host.

**Approach (only one viable):**

- Add `SS_SUBMSG_JOIN_REQUEST` / `SS_SUBMSG_JOIN_RESPONSE` submsgs.
- Add `factory-join-request` plugin RPC (client side) and `factory-incoming-joins` (LSP side, returns queue of pending requests so operator UI can render an accept/reject list).
- LSP-side policy: auto-accept if factory has open slots and policy matches; otherwise queue or reject.
- Wallet UI: client side polls `factory-ceremony-status` once accepted to watch progress; LSP side polls `factory-incoming-joins` to render the pending queue.

**Effort:** ~1 week plugin, ~3 days wallet (LSP and client UI both).

**Note:** Independent of Gap-2 choice — both α and β paths still need this join handshake; β just doesn't carry it (Nostr is for broadcast, not handshake).

---

## 8. Open design questions

These are intentionally unanswered — they require alignment between lib/plugin/wallet teams before they're settled.

1. **`SS_SUBMSG_FACTORY_INFO_*` submsg IDs.** Free range above current usage starts around `0x0140`. Suggested: `0x0140` request, `0x0141` response. To be confirmed by plugin team.
2. **`factory_announce` (kind-38102) schema.** What fields are in the public event? Policy summary? Slot counts? Expiry block? Or just `(instance_id, policy_hash, last_seen_block)` with policy details fetched on demand? Privacy implication: every public event leaks instance count.
3. **Join request authorization.** Does the client need to prove anything (chain control? a refundable deposit? a Nostr identity match against a previously-known vouch)? Or is the LSP free to accept anyone whose CLN node speaks 33001?
4. **Ceremony abort handling in the wallet.** When the plugin reports `CEREMONY_FAILED`, what is the wallet's recovery affordance? Retry? Drop into "exit via revoke tx" UI? Hand off to support?
5. **Coordinator's role in join routing.** Should the coordinator know about join requests (e.g. for matchmaking small clients to factories that have room), or is join strictly host↔client and the coordinator only does discovery vouching?

---

## 9. Versioning

`schema_version: 1` covers everything in this document. Compatible additions (new submsg IDs, new plugin RPCs, new event kinds) do not bump `schema_version` provided existing fields are unchanged. Breaking changes require a new draft (this file copied to `PROTOCOL_V2.md`).

`factory_protocol_id` is currently `"SuperScalar/v1"`. If the SuperScalar wire protocol breaks compatibility, bump to `"SuperScalar/v2"` — peers that don't support v2 simply won't list it in `supported_factory_protocols` and a fallback to v1 happens during handshake.

---

## 10. Cross-references

- `docs/FACTORY_POLICY_V1.md` — what *values* travel through this protocol (M, fee, L, R, lifetimes, etc.). This doc is the messaging substrate; that doc is the payload semantics.
- `superscalar-cln/CONFORMANCE.md` — bLIP-56 substrate deviation log. This doc is the application layer above that substrate.
- bLIP-56 draft — github.com/lightning/blips/pull/56
- SuperScalar design — delvingbitcoin.org series
