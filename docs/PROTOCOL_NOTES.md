# Protocol Implementation Working Notes

> **⚠️ INTERNAL WORKING DOC — DO NOT SHIP**
>
> This file captures live implementation notes for getting the wallet's LSP-side
> and user-side factory functions working end-to-end against the
> `superscalar-cln` plugin and the bLIP-56 substrate. It is **not** a spec, it
> is **not** for external consumption, and it should not be linked from any
> README or shipped doc set.
>
> The polished spec equivalent is `PROTOCOL_V1.md` (also unmerged). When that
> doc is finalized and shipped, this one is deleted.
>
> Last updated: 2026-05-16

## What this doc is for

The "Join Factory" button currently does nothing (sets local React state and
nothing else — see `ConnectList.tsx:311` `handleJoin`). The wallet has no way
to:

1. Ask another host "what factories do you have?"
2. Tell another host "I want to join this factory"
3. Render ceremony progress while a join is being processed

This doc walks through each step of fixing that, mapping wallet actions →
backend HTTP → CLN RPC → plugin code → wire message → other peer, in both
directions.

---

## 1. What's already wired up vs missing

### Wallet → backend (HTTP)

| Endpoint | Status |
|---|---|
| `POST /v1/rendezvous/prepare-vouch-event` | ✓ wired |
| `GET /v1/rendezvous/settings` | ✓ wired |
| `POST /v1/rendezvous/browse-host` | **MISSING** |
| `POST /v1/rendezvous/join-host` | **MISSING** |
| `GET /v1/rendezvous/ceremony-status/:id` | **MISSING** |

### Backend → CLN (JSON-RPC)

The wallet backend calls the plugin via either commando (lnmessage) or Unix
socket. Current set of plugin RPCs the wallet uses:

| Plugin RPC | Used by wallet today? | Wire effect |
|---|---|---|
| `factory-list` | ✓ (`http.service.ts:593`) | none — local query |
| `factory-create` | ✓ (`:612`) | triggers `FACTORY_PROPOSE` + ceremony |
| `factory-rotate` | ✓ (`:616`) | triggers `ROTATE_*` ceremony |
| `factory-close` | ✓ (`:620`) | triggers `CLOSE_*` ceremony |
| `factory-force-close` | ✓ (`:624`) | unilateral broadcast |
| `factory-check-breach` | ✓ (`:628`) | chain query |
| `factory-open-channels` | ✓ (`:634`) | opens factory sub-channels |

Plugin RPCs that already exist but the wallet doesn't currently call:

- `factory-metrics`, `factory-ladder-status`
- `factory-ps-advance` (LEAF_ADVANCE ceremony)
- `factory-buy-liquidity` (client-side LEAF_REALLOC)
- `factory-migrate`, `factory-migrate-complete`, `factory-initiate-exit` (client-side turnover)
- `factory-close-departed`, `factory-confirm-closed`, `factory-scan-external-close`
- `factory-source-check`, `factory-reorg-check`, `factory-abort-stuck`
- 16 `dev-factory-*` (testing only)

### Plugin RPCs that don't exist yet

These are the gaps we need to fill — both in plugin code AND wallet calls:

| RPC | Role | Wire effect |
|---|---|---|
| `factory-browse-host` | client | sends `FACTORY_INFO_REQUEST` (0x0140), awaits `FACTORY_INFO_RESPONSE` (0x0141) |
| `factory-join-request` | client | sends `JOIN_REQUEST` (0x0142), awaits `JOIN_RESPONSE` (0x0143) |
| `factory-join-status` | client | local poll of pending join request |
| `factory-ceremony-status` | both | local poll of ceremony progress |
| `factory-incoming-joins` | LSP | drains queue of received `JOIN_REQUEST`s |
| `factory-decide-join` | LSP | sends `JOIN_RESPONSE` to specific peer |

### Wire submsgs that don't exist yet

Inside `factory_piggyback` with `protocol_id = "SuperScalar/v1"`:

| Submsg ID | Name | Direction |
|---|---|---|
| `0x0140` | `FACTORY_INFO_REQUEST` | client → host |
| `0x0141` | `FACTORY_INFO_RESPONSE` | host → client |
| `0x0142` | `JOIN_REQUEST` | client → host |
| `0x0143` | `JOIN_RESPONSE` | host → client |

### Handshake extension that doesn't exist yet

Inside `0x0002 supported_factory_protocols`:

| TLV | Status | Purpose |
|---|---|---|
| 512 | ✓ exists | List of `factory_protocol_id` strings |
| **514** | **proposed** | Per-protocol feature bitfield (BOLT-9-style even/odd pairs) |

---

## 2. Existing fork-level bLIP-56 substrate the plugin builds on

These already exist in `8144225309/lightning` blip-56 branch — the plugin uses
them, we don't need to rebuild them:

- Feature bit 270/271 advertised in `init`
- TLV 65600 `channel_in_factory` on `open_channel`/`accept_channel`
- Zero-conf channel-open path for factory channels
- Skip on-chain funding watch for factory channels
- Alias SCID routing
- STFU + batch `commitment_signed` for factory rotation
- Internal channeld IPC: 7232/7233/7235/7236 for factory-change coordination
- Fork-level RPCs: `factory-change`, `factory-forget-channel`, `checkutxo`,
  `fundchannel_start`/`complete` factory param extensions

The plugin **doesn't** have to invent any of this. It just calls
`sendcustommsg` for outgoing 33001 traffic and registers a `custommsg` hook
for incoming.

---

## 3. Walkthroughs

> Each walkthrough below traces one user action end-to-end through every
> layer: wallet UI → wallet backend → CLN RPC → plugin code → wire bytes →
> peer plugin → peer CLN RPC → peer reaction. The goal is that by the end of
> each walkthrough, the implementation surface for that flow is obvious.

### 3.1 LSP creates a factory and makes it discoverable

*To be filled in.*

### 3.2 User browses a host's factories

*To be filled in.*

### 3.3 User joins a factory

*To be filled in.*

### 3.4 Ceremony progress reflected in UI

*To be filled in.*

### 3.5 Rotation (LSP-driven)

#### What rotation is

Rotation is the **only** factory event that requires every participant
online and signing simultaneously. It's a full N-of-N MuSig2 ceremony that
re-signs the factory tree at a new epoch and revokes the previous epoch's
state. From the wire perspective:

```
   ROTATE_PROPOSE → ROTATE_NONCE → ROTATE_PSIG → ROTATE_COMPLETE
        ↓
   REVOKE → REVOKE_ACK (LSP retries until acked by each participant)
```

All other operations (leaf advance, leaf realloc, turnover/exit, HTLC
payments, etc.) are 2-of-2 between LSP and one client (or N-of-N within
a single subfactory for wide-leaf cases). **Rotation is the only thing
that pulls everyone in at once.**

#### Rotation cadence: the L parameter

`L` is the factory's **lifetime in epochs**. After L epochs, the factory
must either rotate (extending life by another L) or close. Each rotation
consumes a counter and refreshes the timelock chain. The "+N buffer" in
notations like `L = 30 + 3` is the rotation grace window — the LSP must
start rotation N epochs before expiry so it has time to complete.

L is in a different category from CLTV timeouts or per-channel safety
windows. Those operate at the BOLT-2 sub-channel layer. L operates one
layer up, governing the factory itself.

Epoch duration on mainnet is approximately 144 blocks (~1 day), driven
by the minimum-epoch safety budget — each epoch must be long enough for
a watching client to detect cheating and broadcast the penalty.

#### L limits

The bounds are driven by two competing safety properties: minimum-epoch
safety (sets the floor) and worst-case unilateral-exit time (sets the
ceiling, which scales linearly with L).

| Limit | Value | Block target | Real time | Driven by |
|---|---|---|---|---|
| **Floor** | L = 7 + 2 | ~1,296 blocks | ~9 days | Min-epoch defense window per epoch + minimum useful structural depth |
| **Production default** | **L = 30 + 3** | ~4,752 blocks | **~33 days** | ZmnSCPxj's original target; matches FACTORY_POLICY_V1.md draft |
| **Long-lived override** | L = 60 + 5 | ~9,360 blocks | ~65 days | LSP wants fewer rotations; trades doubled worst-case exit time |
| **Ceiling** | L = 90 + 7 | ~13,968 blocks | ~97 days | Beyond here, worst-case unilateral-exit becomes unacceptably long |

#### Rotation is event-triggered, not scheduled

Naive "rotate every L epochs on a schedule" is the wrong model — most
of the time the factory doesn't need to rotate. Only two events
actually demand rotation:

1. **Approaching expiry.** The factory's epoch counter is about to run
   out, so the LSP must rotate to extend life. This is the
   *expiry-extension rotation*. With L = 30 + 3, the LSP schedules it
   in epoch 27 (3 buffer remaining), so there's time to complete.

2. **Adding new joiners post-creation.** New clients can only be
   incorporated by re-signing the tree shape, which requires all
   existing participants to sign. This is the *join-batched rotation*.

Most "factory lifecycle" events don't require rotation:

- Client exits: TURNOVER ceremony (0x0120-0x0122) — just 2-of-2 between
  LSP and the exiting client. Other participants never notified.
- Leaf advance: 2-of-2 between LSP and that one client.
- Leaf realloc: 2-of-2 or 3-of-3 within one leaf's signer set.
- Wide-leaf subfactory operations: stay inside the subfactory.

#### Strategy for new joiners: spin up new factories, not batched rotation

Given that join-triggered rotation costs every existing participant a
ceremony, the more user-friendly design is **Strategy B from §3.1**:
when new joiners arrive, the LSP doesn't add them to existing factories
— it spawns a new factory for them. Existing factories drain via
TURNOVER over their lifetime; new ones absorb new demand.

This means the **only routine rotation trigger is expiry-extension**.
Users on existing factories see rotation roughly **once per L (~33 days
for default)** — three to twelve times a year, not weekly.

#### Expected per-user signing cadence

With L = 30 + 3, Strategy B, and TURNOVER for exits:

| Event | Frequency per user | Cryptographic cost |
|---|---|---|
| Join (initial ceremony) | Once per factory lifetime | ~5 min online for MuSig2 rounds |
| Expiry-extension rotation | Once per ~33 days, until they exit | ~5 min online |
| Leaf advance / realloc | Whenever LSP needs to, can be done while online | Async, 2-of-2 |
| TURNOVER (exit) | Once when leaving | ~5 min online with LSP |

So a user who joins, stays 3 months, then exits: roughly **3-4 signing
events total** over those 3 months, each ~5 minutes online. That's a
realistic UX for consumer wallets.

#### What this means for wallet UI defaults

- **Default `L = 30 + 3`** for new factory creation in `FactoryCreate`
  dialog — already matches `FACTORY_POLICY_V1.md`.
- **No scheduled rotation by default.** The "auto-rotate periodically"
  toggle should default to `false`; rotation triggers on expiry approach.
- **Block-deadline rotation alerts.** Wallet should compute
  `next_rotation_block ≈ expiry_block - (buffer_epochs × 144)` and warn
  users in their Connect panel "rotation expected around block X, ~3
  days from now" so they can plan presence.
- **"Auto-host-next" on by default.** When the LSP's current factory
  fills, the wallet auto-creates a successor draft so new joiners go
  there. Implements Strategy B.

### 3.6 Cooperative close

*To be filled in.*

---

## 4. Where the data lives at each layer

Reference for walking through flows. Each piece of state has exactly one
authoritative owner; everything else is a derived/cached view.

| Data | Authoritative owner | Cached/derived elsewhere |
|---|---|---|
| Ceremony state (which round, which signers have submitted) | Plugin (`ceremony_state_t` in `factory_state.h`) | Wallet renders via `factory-ceremony-status` polls |
| Factory list (which factories I'm hosting) | Plugin (`ss_state` in plugin process memory + CLN datastore persistence) | Wallet caches via `factory-list` RPC |
| Vouch (Nostr discoverability of an LSP) | Coordinator publishes kind-38101 events to relays | Wallet reads via SimplePool subscription |
| Per-factory policy (M, L, R, fee, etc.) | Plugin (canonical type `ss_factory_policy_t`) | Wallet displays in Connect panel; should match between LSP-set values and what's advertised |
| Active node identity (own pubkey, npub) | Backend (`LspNostrIdentityService` for Nostr, CLN `getinfo` for LN) | Wallet caches in Redux |
| Pending join requests against this LSP | Plugin (in-memory queue + datastore persistence) | LSP wallet polls via `factory-incoming-joins` |
| Channel state for factory sub-channels | CLN core (the channel database) | Wallet reads via standard `listchannels`/`listpeers` |

---

## 5. Open design choices to make as we walk through

These are decisions we still need to make. Listed here so they don't get lost
mid-walkthrough.

- **Authorization for JOIN_REQUEST.** Does a client need to prove anything (chain control? channel with the LSP? Nostr identity matching previously known vouch?), or is the LSP free to accept any feature-bit-270 peer? Affects join_request payload shape.
- **What `factory-incoming-joins` polling cadence looks like for LSP UI.** Once per minute is probably fine; could go faster if we use CLN notifications.
- **Whether browse caches responses on the wallet side.** Per-host browse result might be valid for ~2 minutes? Or always fresh? Avoid hammering peers.
- **Where the kind-38102 `factory_announce` event lives in our priority list.** Per Gap-2 in `PROTOCOL_V1.md`: α (wire-level browse) vs β (Nostr-level broadcast). Likely we want both eventually but α first for the wallet UX win.
- **Feature bit allocations inside `SuperScalar/v1`.** Need plugin team's input on what's actually optional vs mandatory in v1.
- **Submsg ID assignments 0x0140-0x0143.** Need plugin team's blessing — they could pick different numbers.

---

## Cross-references

- `docs/PROTOCOL_V1.md` (also unmerged) — the polished spec equivalent
- `docs/FACTORY_POLICY_V1.md` (also unmerged) — what *values* travel through this protocol
- `superscalar-cln/CONFORMANCE.md` — bLIP-56 substrate deviation log
- `superscalar-cln/ceremony.h` — all existing SS_SUBMSG_* IDs
- `8144225309/lightning` `blip-56` branch — fork-level bLIP-56 changes
