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

### 3.0 Plugin architecture and roles

The plugin runs **identical code** on every CLN node that loads it, but
per-factory it acts in one of two **roles**:

- **LSP role** — the plugin created this factory (via
  `factory-create-draft`). It runs as a persistent server: listens for
  incoming JOIN_REQUESTs, queues them, watches block heights for
  force-start triggers and expiry approach, orchestrates ceremonies,
  retries REVOKEs.
- **Client role** — the plugin received a `FACTORY_PROPOSE` from an
  LSP and joined. It runs as a participant: responds to LSP-initiated
  events when online, persists cryptographic state across disconnects,
  doesn't run a queue.

A single CLN node can be LSP for some factories and a client in others
simultaneously. The role is per-factory state, derived from who
created the factory, not a node-wide setting.

#### Listeners on every running plugin

```
   Plugin event loop (always running while CLN is up):

   Listeners registered with CLN:
     - custommsg hook  (incoming 33001 → dispatch by submsg_id)
     - connect notification (peer comes online → resume any pending
         state for that peer, like retrying REVOKE)
     - block_added notification (new block → check force-start
         deadlines, expiry-rotation triggers, ladder cadence)
     - openchannel hook (open_channel arrives → check TLV 65600 for
         factory-channel context)
     - htlc_accepted hook (HTLC arrives → route via alias SCIDs for
         factory sub-channels)

   JSON-RPC commands registered:
     - factory-* RPCs (see §5)
```

#### Persistent state (in CLN's datastore under `superscalar/...`)

The plugin persists everything that must survive plugin reload, CLN
restart, or peer disconnect:

- **Factory instance records** keyed by `instance_id` — role,
  lifecycle, participant set, ceremony state, expiry block, policy
- **Per-participant records** under each instance — peer_id,
  factory_pubkey, leaf assignment, status (active/departing/departed),
  last_seen_block, pending REVOKE epoch
- **Pending join queues** per draft factory — JOIN_REQUEST records
  awaiting auto-accept evaluation or ceremony start
- **Outstanding REVOKEs** that haven't been acknowledged by their
  target client yet
- **Ladder schedule** — block height of next factory creation (for
  auto-host-next)
- **Active ceremony state** — current round, nonces collected so
  far, partial sigs collected so far, retry counts

Datastore keys follow the convention
`superscalar/<instance_id>/<sub-key>`. Bulk read/write via standard
CLN `listdatastore` / `datastore` RPCs.

#### What happens on plugin restart

1. Plugin starts, enumerates `superscalar/*` datastore entries
2. For each factory instance: reconstruct in-memory state, determine
   where in its lifecycle it sits
3. Resume listening hooks; previously-pending operations (REVOKEs,
   ceremony rounds) replayed from persisted state
4. No data lost across restart; clients can pick up where they left
   off

This makes the plugin **safe to upgrade**: rebuild the binary,
restart CLN, all in-flight factories resume cleanly.

### 3.1 LSP creates a factory and makes it discoverable

Goal: from a clean-slate wallet, get to a state where clients can
browse this LSP's factories and submit JOIN_REQUESTs.

#### Step 1 — LSP advertises itself on Nostr (existing)

This already works (PR #11 and prior). The wallet calls
`POST /v1/rendezvous/prepare-vouch-event`, signs it with the LSP's
Nostr identity key, publishes to enabled relays. The coordinator sees
the advertisement, verifies the proof tier, and publishes a
kind-38101 vouch. Other wallets see the vouch in their Connect tab.

At this point the LSP is **discoverable as a host** but has no
factories yet. Clicking the LSP's row in another wallet's Connect tab
returns an empty factory list (once browse is wired — §3.2).

#### Step 2 — LSP creates a draft factory

User clicks **Host Factory** in the wallet UI. The dialog
(`FactoryCreate.tsx`) collects policy parameters and calls:

```
   wallet UI → POST /v1/rendezvous/create-draft-factory {policy}
   backend → CLN RPC: factory-create-draft
   plugin → creates new factory instance with lifecycle = "drafting"
            persists initial state to CLN datastore
            schedules force_start_block = current + force_start_offset
            returns instance_id to caller
   backend → returns instance_id to UI
   UI shows the new draft in "My Factories" list
```

The plugin does **not** generate nonces, build a tree, or lock funding
UTXOs at this point. Those happen at ceremony-start time (step 5).
The draft is just a record saying "I'm willing to host a factory with
these parameters, and I'll accept up to `max_clients` JOIN_REQUESTs
until the force-start block."

#### Step 3 — Draft factory appears in browse responses

Now that the draft exists in the LSP's plugin state, any client
browsing the LSP will see it. The plugin's `FACTORY_INFO_RESPONSE`
handler enumerates active factories (drafting + forming + active) and
includes them in the response.

The draft factory's wire representation:
- `instance_id: <new>`
- `lifecycle: "drafting"`
- `slots_open: max_clients`
- `slots_total: max_clients`
- `force_start_block: <current + offset>`
- `accepting_joins: true`
- `policy: {...}`

#### Step 4 — Clients submit JOIN_REQUESTs (collected over time)

As clients hit Join in their wallets, `JOIN_REQUEST` wire messages
arrive at the LSP. The plugin's handler:

1. Validates the request (peer connected, factory_protocol_id matches,
   params within the factory's policy)
2. Checks `autoAcceptJoiners` policy: if true and request within
   bounds, immediately accept
3. If auto-accept'd: add peer to factory's participant list, return
   `JOIN_RESPONSE = "accepted, ceremony at block X"`
4. If manual: enqueue for operator review, return
   `JOIN_RESPONSE = "queued"`
5. Persist state to datastore

The factory's `slots_open` decrements per accepted join. LSP-operator
UI sees the queue updating in real time (poll via
`factory-incoming-joins`).

#### Step 5 — Force-start trigger fires

Two conditions can fire the ceremony:

1. **Slots full** — `slots_open` reaches 0; plugin immediately fires
   ceremony (no need to wait for deadline)
2. **Block deadline reached** — `current_block >= force_start_block`;
   plugin fires ceremony with however many participants are accepted,
   *provided* `accepted_count >= min_clients_to_start`. If fewer, the
   ceremony aborts and the LSP operator is notified

When the trigger fires:

1. Plugin broadcasts `CEREMONY_HEARTBEAT` (0x0144) to all accepted
   participants: "ceremony starts in 30 s, confirm presence"
2. Participants reply with `CEREMONY_HEARTBEAT_ACK` (0x0145)
3. Plugin waits 30 s for ACKs (configurable); peers who don't ACK
   are dropped
4. Plugin builds the factory tree from policy + participant list,
   picks funding UTXOs, generates LSP's MuSig2 nonce
5. Plugin broadcasts `FACTORY_PROPOSE` (0x0100) — the ceremony begins

From this point, the existing ceremony machinery in `ceremony.h` takes
over (`FACTORY_PROPOSE` → `NONCE_BUNDLE` → `ALL_NONCES` →
`PSIG_BUNDLE` → `FACTORY_READY` → `DIST_*`).

#### Step 6 — Factory becomes active

After `FACTORY_READY`, the factory transitions to
`lifecycle = "active"`. Sub-channels are open via the existing
TLV-65600 channel-open flow. Day-to-day HTLC routing is factory-blind.
The LSP runs background tasks (breach scans, expiry checks, leaf
advance scheduler) per the existing plugin code.

### 3.2 User browses a host's factories

Goal: user clicks a vouched host in the Connect tab and sees what
factories that host is offering.

#### Pre-conditions

- User's wallet sees the LSP's vouch in Connect tab (existing
  kind-38101 flow)
- User's CLN node speaks bLIP-56 (feature bit 270/271 advertised in
  `init`)
- LSP's CLN node also speaks bLIP-56 (peer advertised TLV 512 entry
  for `"SuperScalar/v1"`)
- A connection between the two nodes either exists or can be
  established

#### The wire round-trip

```
   User UI                  User CLN                 LSP CLN
   ─────────                ──────────               ────────
   click "Browse"
   on host row
        │
        │ POST /v1/rendezvous/browse-host {node_id}
        ▼
   wallet backend
        │
        │ RPC: factory-browse-host {node_id}
        ▼
   plugin (client role)
        │
        │ 1. ensure peer is connected
        │    (listpeers → if not, connect node_id@addr)
        │ 2. check supported_factory_protocols handshake
        │    (if not done, send 0x0002, wait for theirs)
        │ 3. build FACTORY_INFO_REQUEST (0x0140) inside
        │    factory_piggyback (0x0004) w/ protocol_id
        │ 4. sendcustommsg ────── wire ─────────────►  custommsg hook
        │                                              │
        │                                              │ dispatch by submsg_id
        │                                              │ to FACTORY_INFO_REQUEST
        │                                              │ handler
        │                                              │
        │                                              │ enumerate own factories,
        │                                              │ filter by since_block,
        │                                              │ build response
        │                                              │
        │  ◄── FACTORY_INFO_RESPONSE (0x0141) ────┤  sendcustommsg back
        │
        │ custommsg hook fires on our side
        │ 5. correlate by request_id
        │ 6. parse, return JSON to backend
        ▼
   backend → UI
        │
        ▼
   UI renders factory list under host row
```

#### End-to-end latency

| Path | Time |
|---|---|
| Peer connected + handshake done | ~200-500 ms (one round-trip) |
| Peer not connected | + ~500-1000 ms (connect + handshake) |
| Peer unreachable | 5 s timeout, UI shows "unreachable" |

#### Caching

Browse responses are cached client-side for ~2 minutes. Same-host
re-browse within window returns cached response with a "last updated"
indicator. Cache invalidates on:

- Manual refresh click
- User-explicit re-browse
- Any JOIN_REQUEST to that host (stale after join)

### 3.3 User joins a factory

Goal: user picks a factory from the browse list, clicks Join, and
either gets auto-accepted into a participant slot or queued for the
LSP operator's review.

#### The wire round-trip

```
   User UI                  User CLN                 LSP CLN
   ─────────                ──────────               ────────
   click "Join Factory"
            │
            │ confirmation dialog:
            │ - expected ceremony at block X (~5h)
            │ - policy summary
            │ - "wallet must be online during ceremony"
            │
            │ user confirms
            │
            │ POST /v1/rendezvous/join-host {
            │   node_id, instance_id, params
            │ }
            ▼
   wallet backend
            │
            │ RPC: factory-join-request {...}
            ▼
   plugin (client role)
            │
            │ 1. reuse peer connection (just browsed)
            │ 2. build JOIN_REQUEST (0x0142) with
            │    request_id, instance_id, client params,
            │    optional proof TLV
            │ 3. sendcustommsg ──── wire ──────────►  custommsg hook
            │                                          │
            │                                          │ dispatch to
            │                                          │ JOIN_REQUEST handler
            │                                          │
            │                                          │ validate:
            │                                          │ - factory exists
            │                                          │ - accepting & slots_open > 0
            │                                          │ - params within policy
            │                                          │
            │                                          │ if autoAcceptJoiners:
            │                                          │   add to participant set,
            │                                          │   decrement slots_open,
            │                                          │   persist to datastore
            │                                          │ else:
            │                                          │   enqueue for operator
            │                                          │
            │  ◄── JOIN_RESPONSE (0x0143) ──────────┤  build response
            │      { status: "accepted",
            │        instance_id,
            │        ceremony_start_block,
            │        leaf_assignment,
            │        participant_index }
            │
            │ custommsg hook, correlate by request_id
            │ 4. persist local pending-join record
            │ 5. return JSON to backend
            ▼
   backend → UI
            │
            ▼
   UI: "Join accepted — ceremony at block X (~5h)"
   subscribes to ceremony-start push notification
```

#### What happens between accept and ceremony

Both sides persist the pending-join state. The LSP's plugin tracks
the participant in its factory record; the client's plugin tracks the
pending ceremony participation. Either side can disconnect, restart,
or change IPs — the state survives.

When the force-start trigger fires (step 5 in §3.1), the LSP sends
`CEREMONY_HEARTBEAT` to all participants. The client plugin's
handler receives it, replies with `HEARTBEAT_ACK`, and waits for
`FACTORY_PROPOSE`.

#### Edge cases

| Condition | JOIN_RESPONSE.status | Client behavior |
|---|---|---|
| Factory already started ceremony | `"rejected_ceremony_active"` | Try a different factory |
| Slots full but factory pre-ceremony | `"queued_for_next"` + `expected_block` | Wait for next factory creation (Strategy B) |
| Factory `lifecycle=active`, LSP supports late-join | `"queued_for_next_rotation"` + `expected_block` | Wait for rotation |
| Factory `lifecycle=active`, LSP no-late-join | `"rejected_no_late_join"` | Try a different factory |
| Params outside policy bounds | `"rejected_policy_mismatch"` + `reason` | Adjust params or different factory |
| Pubkey on banlist | `"rejected_banned"` | (terminal — user can't recover) |

### 3.4 Ceremony progress reflected in UI

Goal: from the moment ceremony starts (`FACTORY_PROPOSE` arrives)
until it completes (`FACTORY_READY` received), the user sees clear
progress in the wallet UI.

#### Polling pattern

Wallet polls the plugin's `factory-ceremony-status` RPC every 1-2
seconds while a ceremony is active. RPC returns:

- `state` — enum: `IDLE`, `PROPOSED`, `NONCES_COLLECTED`,
  `PSIGS_COLLECTED`, `COMPLETE`, `FAILED`
- `current_round` — 1, 2, or "distribution"
- `participants_total`
- `participants_responded_this_round`
- `time_remaining_seconds` — until round timeout
- `error` — non-null only if state == `FAILED`

UI renders:

- A progress bar across the 5 ceremony stages
- "3 of 7 participants have submitted nonces" subtitle
- Estimated time remaining
- Cancel-ceremony button (only useful LSP-side, only before round 2)

#### Push notification trigger

Two events deserve OS-level notifications because users may not have
the wallet in focus:

1. **`CEREMONY_HEARTBEAT` received** — "Factory ceremony starting in
   30 seconds, keep wallet open"
2. **`FACTORY_READY` received** — "Factory ceremony complete, your
   sub-channel is open"

These push via the browser/OS notification API (`Notification` web
API on desktop, push subscriptions on mobile). User must have granted
notification permission during onboarding.

#### Recovery from ceremony failure

If ceremony fails (timeout, abort, signature verification failure):

- UI shows "Ceremony failed — reason: <reason>"
- LSP-side: factory returns to `lifecycle = "drafting"` with the
  participant list intact (minus the non-responsive party). Operator
  can manually re-trigger if appropriate.
- Client-side: pending-join record updated with
  `status: "ceremony_failed"`. User can retry against a different
  factory.

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

Goal: factory winds down cleanly, all participants sign the close,
on-chain settlement happens.

This is the existing `factory-close` RPC + ceremony flow
(`CLOSE_PROPOSE` → `CLOSE_NONCE` → `CLOSE_ALL_NONCES` → `CLOSE_PSIG`
→ `CLOSE_DONE`). No new wire surface needed.

#### When it fires

- LSP operator manually invokes `factory-close` (e.g., end of
  factory's useful life)
- Factory's `autoFinalizeOnDying` is true and expiry is approaching
  with no rotation scheduled

#### What participants see

Same as a regular all-online ceremony — `CEREMONY_HEARTBEAT` first,
then the close ceremony. About 3-5 minutes wall-clock time. Final
on-chain transaction settles funds to each participant's keys.

#### Departed participants

Participants who already exited via TURNOVER are absent from the
close ceremony. The LSP's plugin tracks who's still active vs
departed via the participant_record status field. Close ceremony
only invites active participants.

---

## 4. Wire format spec — the 6 new submsgs

All payloads are inside `factory_piggyback` (bLIP-56 submsg `0x0004`)
with `protocol_id = "SuperScalar/v1"` (32 bytes ASCII zero-padded).
Big-endian everywhere. Hand-rolled in plugin C using `towire_u*` /
`fromwire_u*` from `common/towire.h`. Fixed-layout for required
fields; trailing TLV stream for optional/extensible fields.

### 4.1 FACTORY_INFO_REQUEST (0x0140)

Client asks: "what factories do you have?"

```
   Inside factory_piggyback payload (after protocol_id[32]):
   ┌──────────────────────────────────────────────────────┐
   │ u16   app_submsg_id        = 0x0140                  │
   │ u64   request_id           (correlation id; echoed   │
   │                              in response)            │
   │ u32   since_block          (0 = all factories;       │
   │                              else only created       │
   │                              after this block)       │
   ├──────────────────────────────────────────────────────┤
   │ Trailing TLV stream (all optional):                  │
   │   TLV 1: only_accepting_joins (1 byte: 0/1)          │
   │   TLV 3: min_slots_open_filter (u8)                  │
   │   TLV 5: max_results (u16, default 32)               │
   └──────────────────────────────────────────────────────┘

   Fixed bytes: 2 + 8 + 4 = 14 bytes
   Plus 32-byte protocol_id from piggyback wrapper = 46 bytes total
   inside the 33001 wire payload.
```

### 4.2 FACTORY_INFO_RESPONSE (0x0141)

LSP replies with its factory list.

```
   Inside factory_piggyback payload:
   ┌──────────────────────────────────────────────────────┐
   │ u16   app_submsg_id        = 0x0141                  │
   │ u64   request_id           (echoes request)          │
   │ u32   snapshot_block       (height when assembled)   │
   │ u8    n_factories                                    │
   │                                                      │
   │ Repeated n_factories times — factory_entry:          │
   │   ┌──────────────────────────────────────────────┐  │
   │   │ u8[16]  instance_id                           │  │
   │   │ u8      lifecycle  (enum byte:               │  │
   │   │           0=drafting, 1=forming, 2=active,   │  │
   │   │           3=rotating, 4=closing, 5=expired)  │  │
   │   │ u32     created_block                         │  │
   │   │ u32     expiry_block                          │  │
   │   │ u32     force_start_block  (0 if no deadline) │  │
   │   │ u8      slots_open                            │  │
   │   │ u8      slots_total                           │  │
   │   │ u8      min_clients_to_start                  │  │
   │   │ u8      accepting_joins      (0/1)            │  │
   │   │ u16     trailing_tlv_len                      │  │
   │   │ ... policy summary TLVs ...                   │  │
   │   └──────────────────────────────────────────────┘  │
   │                                                      │
   │ Trailing TLV stream at the response level:           │
   │   TLV 1: host_accepting_new_factories (1 byte 0/1)   │
   │   TLV 3: host_alias_utf8 (variable, up to 32B)       │
   │   TLV 5: next_factory_creation_block (u32)           │
   └──────────────────────────────────────────────────────┘
```

Each `factory_entry`'s policy TLV stream carries (TLV types are
SuperScalar-internal, scoped to this submsg):

| TLV type | Field | Type | Meaning |
|---|---|---|---|
| 0 | `M` | u8 | Max channel count per leaf |
| 1 | `L_epochs` | u8 | Lifetime in epochs |
| 2 | `R_blocks` | u32 | Rotation cadence buffer |
| 3 | `wide_leaf_arity` | u8 | k for k² subfactory (1 = flat) |
| 4 | `leaf_arity` | u8 | 1 or 2 |
| 5 | `leaf_channel_type` | u8 | 0=PS, 1=LN-penalty |
| 6 | `fee_msat_per_channel` | u64 | LSP's fee |
| 7 | `min_client_capital_sat` | u64 | Min stake required from joiner |
| 8 | `early_warning_blocks` | u16 | Safety-baseline pre-rotation notice |

### 4.3 JOIN_REQUEST (0x0142)

Client requests participation in a specific factory.

```
   Inside factory_piggyback payload:
   ┌──────────────────────────────────────────────────────┐
   │ u16    app_submsg_id   = 0x0142                       │
   │ u64    request_id       (correlation)                 │
   │ u8[16] instance_id      (which factory)               │
   │ u64    client_capital_sat   (how much they stake)     │
   │ u8[33] client_factory_pubkey (their MuSig2 share)     │
   │ u8[33] client_channel_pubkey (their channel partner   │
   │                                key)                   │
   │ u32    expires_at_block  (request stale after this    │
   │                            block; LSP rejects)        │
   │ u16    trailing_tlv_len                               │
   │                                                       │
   │ Trailing TLV stream (all optional):                   │
   │   TLV 1: client_alias_utf8 (variable, up to 32B)      │
   │   TLV 3: preferred_leaf_index (u8, hint only)          │
   │   TLV 5: proof_of_capital (TLV stream — UTXO proof,   │
   │            channel-control proof, or vouch-id-echo)    │
   │   TLV 7: contact_addr_hint (string — for offline      │
   │            re-contact, e.g. "1.2.3.4:9735")           │
   └──────────────────────────────────────────────────────┘
```

`client_factory_pubkey` and `client_channel_pubkey` are the public
keys the joiner commits to using in the upcoming ceremony. Once
JOIN_REQUEST is accepted, the LSP locks these into the factory tree
state at ceremony start.

### 4.4 JOIN_RESPONSE (0x0143)

LSP responds: accepted, queued, or rejected.

```
   Inside factory_piggyback payload:
   ┌──────────────────────────────────────────────────────┐
   │ u16    app_submsg_id   = 0x0143                       │
   │ u64    request_id       (echoes request)              │
   │ u8     status           (enum byte:                   │
   │           0 = accepted                                │
   │           1 = queued_for_next_factory                 │
   │           2 = queued_for_next_rotation                │
   │           3 = rejected_ceremony_active                │
   │           4 = rejected_policy_mismatch                │
   │           5 = rejected_no_late_join                   │
   │           6 = rejected_banned                         │
   │           7 = rejected_capacity_full                  │
   │           8 = rejected_proof_invalid                  │
   │           9 = rejected_protocol_unsupported           │
   │           255 = rejected_other                        │
   │           )                                           │
   │ u32    ceremony_start_block  (0 if rejected/queued    │
   │                                without known block)   │
   │ u8     participant_index (0-127 if accepted, 0xff     │
   │                            otherwise)                 │
   │ u16    trailing_tlv_len                               │
   │                                                       │
   │ Trailing TLV stream:                                  │
   │   TLV 1: rejection_reason_utf8 (only present when    │
   │           status indicates rejection or queueing)    │
   │   TLV 3: leaf_index (u8, present when accepted)       │
   │   TLV 5: expected_unlock_block (u32, when queued)     │
   └──────────────────────────────────────────────────────┘
```

### 4.5 CEREMONY_HEARTBEAT (0x0144)

LSP to all participants: "ceremony begins in N seconds, confirm
presence."

```
   Inside factory_piggyback payload:
   ┌──────────────────────────────────────────────────────┐
   │ u16    app_submsg_id   = 0x0144                       │
   │ u8[16] instance_id     (which factory's ceremony)     │
   │ u8     ceremony_type   (0=create, 1=rotate, 2=close,  │
   │                          3=leaf_advance,              │
   │                          4=leaf_realloc)              │
   │ u32    expected_propose_block                         │
   │ u16    ack_window_seconds                             │
   │ u8     participants_total                             │
   │ u16    trailing_tlv_len                               │
   │                                                       │
   │ Trailing TLV (optional):                              │
   │   TLV 1: abort_block (u32 — if not all ACK by this    │
   │           block, ceremony aborts)                      │
   └──────────────────────────────────────────────────────┘
```

### 4.6 CEREMONY_HEARTBEAT_ACK (0x0145)

Participant to LSP: "I'm here, ready."

```
   Inside factory_piggyback payload:
   ┌──────────────────────────────────────────────────────┐
   │ u16    app_submsg_id   = 0x0145                       │
   │ u8[16] instance_id                                    │
   │ u8     participant_index                              │
   │ u32    current_block_height (tells LSP our view of    │
   │                                chain tip)             │
   │ u16    trailing_tlv_len                               │
   │                                                       │
   │ (No TLVs defined in v1.)                              │
   └──────────────────────────────────────────────────────┘
```

### 4.7 TLV 514 — per-protocol feature bitfield (new in handshake)

Added to the existing `supported_factory_protocols` submsg (0x0002)
alongside TLV 512. Same submsg, additive TLV — old peers without 514
parsing skip it without breakage.

```
   TLV 514 value layout — repeated tuples:

   ┌──────────────────────────────────────────────────────┐
   │ For each protocol_id the sender supports:            │
   │   ┌─────────────────────────────────────────────┐   │
   │   │ u8[32]  protocol_id                          │   │
   │   │ u8      bitfield_byte_count   (0-32)         │   │
   │   │ byte[]  bitfield                             │   │
   │   └─────────────────────────────────────────────┘   │
   │                                                      │
   │ Concatenated; no separator.                          │
   └──────────────────────────────────────────────────────┘
```

Feature bit allocations for `"SuperScalar/v1"` (BOLT-9-style even/odd
pairs — even = required, odd = optional/may-ignore):

| Bit | Pair | Feature |
|---|---|---|
| 0 / 1 | wide_leaf | k≥2 subfactory support (ARITY_2) |
| 2 / 3 | ptlc_turnover | PTLC-based key turnover for exits |
| 4 / 5 | per_leaf_advance | Cheaper 2-of-2 leaf re-sign optimization |
| 6 / 7 | per_leaf_realloc | 2-of-2 value transfer without chain advance |
| 8 / 9 | per_leaf_realloc_3of3 | 3-of-3 variant for ARITY_2 leaves |
| 10 / 11 | buy_liquidity | Post-create capacity purchase |
| 12 / 13 | auto_host_next | Ladder-cadence auto-spawn next factory |
| 14 / 15 | auto_rotate | Scheduled rotation regardless of need |
| 16+ | reserved | Future v1 features |

Handshake processing rule: A's required bits ⊆ B's all bits **and**
B's required bits ⊆ A's all bits → handshake succeeds, optional
features taken from intersection of optionals. Otherwise → connection
fails with explicit error.

---

## 5. RPC payload shapes — JSON for each new command

These are wallet-side contracts: what the wallet's plugin-RPC client
sends and what it parses on the way back. Stable across protocol
versions; submsg numbering can evolve independently underneath.

### 5.1 factory-create-draft

LSP creates a draft factory accepting joiners (no ceremony yet).

```jsonc
// request
{
  "method": "factory-create-draft",
  "params": {
    "max_clients": 32,
    "min_clients_to_start": 4,
    "force_start_block_offset": 36,
    "policy": {
      "M": 3, "L_epochs": 30, "R_blocks": 432,
      "wide_leaf_arity": 1, "leaf_arity": 1,
      "leaf_channel_type": "pseudo-spilman",
      "fee_msat_per_channel": 250000,
      "min_client_capital_sat": 100000,
      "early_warning_blocks": 144
    },
    "auto_accept_joiners": true,
    "banlist": []  // optional: list of hex pubkeys to always reject
  }
}

// response
{
  "result": {
    "instance_id": "f3a1c...",   // 16-byte hex
    "force_start_block": 879312
  }
}
```

### 5.2 factory-browse-host

```jsonc
// request
{
  "method": "factory-browse-host",
  "params": {
    "node_id": "03ac03ff...",
    "timeout_ms": 5000,
    "since_block": 0,       // optional, filter
    "max_results": 32       // optional, default 32
  }
}

// response
{
  "result": {
    "host_node_id": "03ac03ff...",
    "host_accepting_new_factories": true,
    "snapshot_block": 879237,
    "factories": [
      {
        "instance_id": "f3a1...",
        "lifecycle": "drafting",
        "created_block": 879200,
        "expiry_block": 0,           // 0 until ceremony fires
        "force_start_block": 879312,
        "slots_open": 28,
        "slots_total": 32,
        "min_clients_to_start": 4,
        "accepting_joins": true,
        "policy": { /* ... */ }
      }
    ]
  }
}
```

### 5.3 factory-join-request

```jsonc
// request
{
  "method": "factory-join-request",
  "params": {
    "node_id": "03ac03ff...",          // target LSP
    "instance_id": "f3a1...",
    "client_capital_sat": 450000,
    "client_factory_pubkey": "02...",
    "client_channel_pubkey": "03...",
    "expires_at_block": 879500,
    "contact_addr_hint": "vps3.me:9735",  // optional
    "preferred_leaf_index": null            // optional hint
  }
}

// response
{
  "result": {
    "request_id": "abcd1234...",   // u64 hex, for status polling
    "status": "accepted",          // or queued_*/rejected_*
    "instance_id": "f3a1...",
    "ceremony_start_block": 879312,
    "participant_index": 12,
    "leaf_index": 6,
    "rejection_reason": null
  }
}
```

### 5.4 factory-join-status

```jsonc
// request
{ "method": "factory-join-status", "params": { "request_id": "abcd1234..." } }

// response
{
  "result": {
    "request_id": "abcd1234...",
    "status": "pending_ceremony", // or ceremony_in_progress, completed, failed
    "instance_id": "f3a1...",
    "ceremony_start_block": 879312,
    "current_block": 879309,
    "blocks_remaining_until_ceremony": 3
  }
}
```

### 5.5 factory-incoming-joins (LSP-side)

```jsonc
// request
{ "method": "factory-incoming-joins", "params": { "instance_id": null } }
// instance_id null = all factories' queues

// response
{
  "result": {
    "queues": [
      {
        "instance_id": "f3a1...",
        "pending_joins": [
          {
            "request_id": "...",
            "peer_id": "02ab...",
            "client_capital_sat": 450000,
            "requested_at_unix": 1716000000,
            "auto_accept_decision": "accepted",   // or queued/rejected
            "rejection_reason": null
          }
        ]
      }
    ]
  }
}
```

### 5.6 factory-decide-join (LSP manual override)

```jsonc
// request
{
  "method": "factory-decide-join",
  "params": {
    "request_id": "abcd1234...",
    "decision": "accepted",     // or "rejected"
    "reason": null              // optional rejection reason
  }
}

// response
{ "result": { "ok": true } }
```

### 5.7 factory-trigger-ceremony (LSP manual override)

```jsonc
// request
{ "method": "factory-trigger-ceremony", "params": { "instance_id": "f3a1..." } }

// response
{
  "result": {
    "ok": true,
    "ceremony_start_block": 879310,
    "participants_count": 7
  }
}
```

### 5.8 factory-ceremony-status (both sides)

```jsonc
// request
{ "method": "factory-ceremony-status", "params": { "instance_id": "f3a1..." } }

// response
{
  "result": {
    "instance_id": "f3a1...",
    "ceremony_type": "create",
    "state": "NONCES_COLLECTED",
    "current_round": 2,
    "participants_total": 7,
    "participants_responded_this_round": 5,
    "time_remaining_seconds": 48,
    "error": null
  }
}
```

---

## 6. Where the data lives at each layer

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

## 7. Open design choices to make as we walk through

These are decisions we still need to make. Listed here so they don't get lost
mid-walkthrough.

- **Authorization for JOIN_REQUEST.** Does a client need to prove anything (chain control? channel with the LSP? Nostr identity matching previously known vouch?), or is the LSP free to accept any feature-bit-270 peer? Affects join_request payload shape.
- **What `factory-incoming-joins` polling cadence looks like for LSP UI.** Once per minute is probably fine; could go faster if we use CLN notifications.
- **Whether browse caches responses on the wallet side.** Per-host browse result might be valid for ~2 minutes? Or always fresh? Avoid hammering peers.
- **Where the kind-38102 `factory_announce` event lives in our priority list.** Per Gap-2 in `PROTOCOL_V1.md`: α (wire-level browse) vs β (Nostr-level broadcast). Likely we want both eventually but α first for the wallet UX win.
- **Feature bit allocations inside `SuperScalar/v1`.** Need plugin team's input on what's actually optional vs mandatory in v1.
- **Submsg ID assignments 0x0140-0x0143.** Need plugin team's blessing — they could pick different numbers.

---

## 8. Privacy & Tor recommendations

Factory participation has a stronger privacy footprint than ordinary Lightning
payments. We need to be honest about this in the wallet UX so users opt in
knowingly.

### What an LSP learns about a client who joins a factory

| Datum                                   | When the LSP learns it                                          | Mitigation                                                  |
| --------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Client's node_id                        | Required for BOLT-8 handshake                                   | Use a per-factory ephemeral node_id (not currently spec'd)  |
| Client's IP address                     | TCP layer reveals it on direct connect                          | Tor (.onion) on both sides                                  |
| Client's stake amount + funding output  | Funding TX is on chain                                          | None — public chain                                         |
| Client's leaf position + co-leaf peers  | Required for MuSig2 ceremony                                    | Inherent to design                                          |
| Persistent identity binding over time   | Same node_id appears across rotation events                     | Per-factory ephemeral node_ids                              |
| HTLC routing patterns through this leaf | Standard LSP-as-counterparty information                        | Same as any LSP relationship                                |

Compare to a normal payment routed through a public LSP — that LSP sees only
the incoming/outgoing HTLC; it doesn't know who the sender or receiver is, and
the relationship is ephemeral. **Factory joining is a persistent identity
binding.** Worth saying out loud in the join UI.

### Why direct peering instead of onion-routed messages

Ceremony traffic — NONCE_BUNDLE, PSIG_BUNDLE, DIST_* — runs at high frequency
and can exceed several KB per message with 128 clients. BOLT-12 onion messages
are size-limited (~1300 bytes per hop, ~32 KB total path) and latency-prone
(multi-hop adds seconds per round-trip). Forcing the ceremony through onion
routing would make signing infeasible for large factories.

We use BOLT-12 onion messages only for **low-bandwidth async signals**:
- "Factory rotating in N blocks, please come online" wake-up nudges (Phase 4+)
- LSP-to-LSP factory advertisements as a complement to Nostr (later)

Everything else rides BOLT-1 custommsg over direct BOLT-8 — which means
direct peering with the LSP IP-layer visible.

### Recommended wallet UX defaults

1. **Tor on by default** for any wallet that touches factory join. Make the
   user opt out, not opt in. CLN supports this natively (`--bind-addr=statictor:...`)
   so the wallet just needs to enable it during initial setup.

2. **Show a one-time privacy notice** the first time a user opens the
   factory-browse or factory-join screen, summarizing the table above in
   plain language ("Joining a factory means the LSP can link your wallet
   identity to your payment activity for the lifetime of the factory.
   We recommend Tor.").

3. **Clear "you're peered with N LSPs" indicator** somewhere visible — so
   users understand which LSPs see them and can disconnect if needed.

### Things we explicitly do NOT promise

- We do **not** promise sender unlinkability — the LSP knows you. A snitch
  LSP can correlate your node_id with all your HTLC activity through the
  factory's leaves.
- We do **not** promise plausible deniability — once you've signed a leaf,
  there is on-chain evidence your node_id participated.
- We do **not** promise privacy from a global passive observer — chain
  surveillance can correlate funding outputs with the public factory
  instance_id once we advertise it.

These limits are fundamental to the channel-factory model, not bugs.

### Open design choice: ephemeral per-factory node_ids

A client could spin up a fresh CLN node (fresh `hsm_secret`) for each
factory they join. That severs the link between their factory-leaf identity
and their main routing/payment node. Cost: two CLN daemons per device, which
is feasible on a phone but heavy. Worth designing for Phase 5 wallet UX if
the user demand is there. Not in scope for Phase 2/3/4.

---

## 9. Phase tracker

Implementation progress against the plan. Updated as phases complete.

### Status table

| # | Phase | Status | Where |
|---|---|---|---|
| 0 | Fork feature bit 270/271 advertisement | **✅ DONE** | `lightning` PR #3 merged into VPS deploy. Bit 271 now advertised on both signet daemons. Confirmed via `getinfo`. |
| 1a | bLIP-56 substrate alive between two real signet nodes | **✅ DONE** | Handshake submsg 0x0002 fires bidirectionally between test-lsp-c and test-client-d. |
| 1b | Existing ceremony works end-to-end | **✅ DONE** | Factory `b5579e70...` on signet has `ceremony: complete`, `dist_signed_txid` populated. Funding tx `2a8928f8...` in mempool. Original "failure" was operator error (over-ask vs balance), not lib bug. |
| 2 | Plugin: browse — submsgs 0x0140/0x0141 + `factory-browse-host` RPC | **✅ DONE** | superscalar-cln PR #50 merged. PR #52 (hang fixes + hardening) merged. Verified end-to-end on signet, ~10ms per call. |
| 3 | Plugin: join — submsgs 0x0142/0x0143/0x0144 + `factory-join-request` / `factory-cancel-join` / `factory-incoming-joins` RPCs + LSP queue + persistence both sides | **🟢 NEXT** | Mine. Wire-only. |
| 4 | Plugin: force-start + heartbeat — submsg 0x0145 + `factory-trigger-ceremony` + preflight balance check + `feerate_perkw` param on 9 RPCs | Not started | Mine. **On-chain spend re-enters here; preflight check bundled to land in same PR.** |
| 5 | Wallet: HTTP wrappers + UI — Connect / Host / My Memberships / My Factories tabs | Not started | Mine. |

### What's IN Phase 3 (locked in 2026-05-17)

Decisions finalized in design discussion before coding:

| Component | Decision |
|---|---|
| Persistence backend | CLN `datastore` via existing `ss_save_factory` pattern, extended to include queue + roster |
| LSP persists pending-join queue + accepted-joiner roster | Yes |
| Client persists outgoing join requests | Yes — `ss_state.outgoing_joins[]`, persisted as new datastore key |
| Joiner availability profile in JOIN_REQUEST | **No (single mode for v1)** |
| LSP signing-time decision | **Fully automatic** — gated by `min_clients_to_start` policy, no human-in-the-loop |
| Auto-accept policy at join time | Yes (`auto_accept_joiners=true` default) |
| Dedup behavior | Reject duplicate `(client_node_id, instance_id)` with `status: "already_queued"` |
| New wire submsgs | `0x0142` JOIN_REQUEST, `0x0143` JOIN_RESPONSE, `0x0144` JOIN_CANCEL (heartbeat 0x0145 reserved for Phase 4) |
| New RPCs | `factory-join-request`, `factory-cancel-join`, `factory-incoming-joins` |
| Browse cache | None — fresh round-trip every time |
| Client signing UX (default) | Auto-sign when wallet is open; quit wallet to opt out of a ceremony |
| Manual signing approval mode | Deferred (advanced setting later) |

### What's NOT in Phase 3 (deferred — DO NOT BUILD NOW)

These items came up during design and are explicitly out of scope for this phase. Each is tracked separately so we don't lose them.

| Deferred item | Why deferred | Where it goes |
|---|---|---|
| Manual operator approval at ceremony go/no-go time | Adds operator-online dependency for no v1 benefit | Future phase as advanced setting |
| Persistent per-factory blacklist | Needs schema, UI, real usage to inform shape | Future phase |
| Persistent global whitelist | Same | Future phase |
| Reputation scoring across multiple factories | Needs real traffic data to design well | Task #59 (production hardening) |
| Per-peer slot cap on browse/join RPCs | Needs data | Task #59 |
| Persistent `ss_browse_next_request_id` across restart | Needs broader persistence strategy review | Task #59 |
| Structured error codes / taxonomy | Needs designed schema, not ad-hoc | Task #59 |
| Metrics endpoint | Needs observability strategy | Task #59 |
| Configurable timeouts via plugin options | Currently hardcoded `SS_BROWSE_TIMEOUT_SECS=30`; could be `--superscalar-browse-timeout-secs=N` later | Task #59 |
| **Structured** audit log (JSON events, indexed by type, retention rules) | v1 has verbose `plugin_log(LOG_INFORM,…)` for every state transition, which is sufficient for grep-based debugging | Task #59 |
| Automated test suite (unit + integration) | Substantial effort, separate work | Task #59 |
| Fuzz testing of wire parsers | Same | Task #59 |
| Joiner "availability profile" field in JOIN_REQUEST | Premature without UX data | Future phase |
| Pre-rotation availability negotiation between LSP and joiners | Same | Future phase |
| Forced kick of inactive joiners | Just let them miss rotations; not expelled | Not needed |
| Authorization for join requests | Any peer can ask; auto-accept policy gates | Future phase |
| Wallet UI for "My Memberships" / "My Factories" tabs | Phase 5 work (data layer first) | Phase 5 |
| "Activity" status badge in nav | UI polish | Phase 5 |
| Browse result caching | Premature; round-trip is fast enough | Maybe never |
| Cross-LSP factory migration / portability | Not in scope | Future phase |
| Joiner lifecycle "history" view in wallet | Closed factories archived, not deleted | Phase 5 |
| BOLT-12 onion-message push notifications | Pattern A (wallet polls on load) + Pattern B (LSP returns `already_member` on dupe) covers v1 | Phase 4+ |
| **Privacy pass: minimize / hash / slash records before mainnet** | Persistent join records currently retain client_node_id, contribution amounts, block heights for diagnosis. Pre-mainnet we need to revisit retention, hashing, and selective deletion. All persistence write-sites get `/* TODO(privacy): … */` markers at code-write time. | Pre-mainnet hardening |

### What's IN Phase 3 (refined during 2026-05-17 design discussion)

Confirmed additions that came out of refinement after initial scope:

- **`factory-kick-joiner` RPC** (LSP-only): kick a queued/accepted joiner before ceremony with optional reason. Changes `join_queue` entry status to REJECTED and sends unsolicited JOIN_RESPONSE to the kicked client.
- **`JOIN_STATUS_ALREADY_MEMBER` status value**: dedup safety net — if a client tries to re-join a factory they're already in, LSP returns this status. Combined with Pattern A wallet-polling-on-load, covers both auto-refresh and user-initiated double-attempt.
- **`/* TODO(privacy): … */` markers**: every persistent join record write gets a code comment so a future privacy pass can grep all retention sites at once.
- **JOIN_CANCEL is informational, not authoritative**: client's local auto-sign refusal is what actually opts them out; LSP just records the cancel for visibility in its queue UI. No race-condition handling needed in the ceremony state machine.

---

## 10. Architecture: chain watching and persistence boundaries

### The realization (caught during Phase 3 wrap-up)

SuperScalar isn't just a crypto library — it's a **complete factory implementation** with multiple standalone binaries:

| Binary | Role |
|---|---|
| `superscalar_lsp` | Full LSP daemon (networking + state + watchtower embedded) |
| `superscalar_client` | Full client daemon (state + watchtower embedded via SDK) |
| `superscalar_watchtower` | Standalone breach watcher (for separation-of-trust deployments) |
| `superscalar_bridge` | (auxiliary) |
| `libsuperscalar.a` | Shared library used by all four |

All four share:
- A **`chain_backend` interface** (`include/superscalar/chain_backend.h`) with three implementations:
  - `chain_backend_regtest.c` — in-memory mock
  - `chain_backend_rpc.c` — bitcoin-cli RPC (full node)
  - `bip158_backend.c` — **BIP-157/158 compact block filter LITE client** (Neutrino-style)
- A **`watchtower` module** (`watchtower.c`) used as an embedded library by lsp/client/standalone
- A **`persist.c`** SQLite-based persistence used by all standalone binaries

### Where the CLN plugin sits

The `superscalar-cln` plugin is a **CLN-runtime adapter**, not a full implementation. It re-implements ceremony coordination on top of CLN's transport (BOLT-8 custommsg) and persistence (CLN datastore).

This is genuinely useful — it lets factory mechanics work inside an existing CLN node — but it duplicates infrastructure that SuperScalar already provides standalone.

### Chain watching: who owns it

**The plugin should NOT do chain watching itself.** That's `superscalar_watchtower`'s job. The plugin's previous breach scan code (`ss_launch_breach_scan` + `state_scan_block_cb` callbacks) was a third parallel implementation that:
- Bypassed `chain_backend` abstraction
- Used CLN's `getblockhash` / `getblock` RPCs which were removed in recent CLN versions
- Duplicated logic that already exists in `superscalar_watchtower`

**Permanent architectural decision (Phase 3):** these functions are no-ops with comments redirecting to this section.

### Persistence: where the data really belongs

| Layer | Current state | Long-term target |
|---|---|---|
| CLN datastore | Used by plugin for factory state, join queues, outgoing joins | Phased out (Phase 6+) |
| SuperScalar SQLite | Used by all standalone binaries via `libsuperscalar`'s `persist.c` | **Canonical storage** |
| bLIP-56 | Wire spec only — no state of its own | n/a |

**The canonical answer:** factory state should live in SuperScalar's SQLite, accessed via `libsuperscalar`'s `persist.c`. That way the watchtower, sweeper, recovery tool, and any other SuperScalar consumer can read it natively.

### Three-tier roadmap

```
NOW (Phase 3 wrap-up):
   Plugin's breach scan code marked as permanent no-op
   Plugin persists to CLN datastore only
   Watchtower NOT integrated — fine for signet testing where there
   are no real factories with funds at risk
   Status: testable; dashboard work unblocked
   Mainnet-ready: NO

PHASE 4 (pre-mainnet hardening):
   Writer hook: plugin exports per-epoch state-root txids to a
   SuperScalar-compatible SQLite DB the watchtower can read.
   Run superscalar_watchtower alongside the daemon.
   Two processes; ~50 lines plugin change.
   Status: mainnet-acceptable.

PHASE 6+ (architectural cleanup):
   Full library embed: plugin uses libsuperscalar's watchtower module
   directly + a chain_backend adapter for CLN's bcli RPCs.
   Single process, single state store, cleanest ops.
   ~300 lines plugin change.
```

### Why not Phase 6+ now

We're not building the dedicated SuperScalar node here — we're building the CLN-integrated path because users want factories to live inside their existing CLN setup. The full embed is the right end state but requires:
- A `chain_backend` implementation that uses CLN's bcli RPCs
- Migration of plugin state from CLN datastore to libsuperscalar's persist
- Testing both paths interoperate (a user might run `superscalar_lsp` AND the CLN plugin against different factories)

That's a substantial refactor and best done once Phase 3 has settled and we have a real dashboard exercising the wire layer.

### Lite client / Neutrino mode

Already exists in SuperScalar as `bip158_backend.c`. Once the plugin uses libsuperscalar's persistence directly (which is the corrected architecture below), the CLN plugin can use this backend too — no full-node requirement, no third-party Esplora trust assumption. The BIP-157/158 compact filter approach is the right answer for mobile-class plugin deployments.

### Architectural correction (2026-05-17) — plugin uses libsuperscalar SQLite, not CLN datastore

After deeper analysis with the lib team, the original "CLN datastore as canonical plugin storage" plan was wrong for SuperScalar's data shape. Corrected architecture:

**Plugin opens its own SQLite file at `$lightning_dir/superscalar/state.db` via libsuperscalar's existing `persist.c` API.** Same library. Same schema. Same file the standalone `superscalar_lsp` binary uses.

#### Why the correction

CLN datastore is **KV with no SQL semantics** — no JOINs, no indexes, no transactions across keys. Fine for ~hundreds of small records. SuperScalar's relational model has ~40 tables with JOINs across factories / channels / HTLCs / old_commitments / breach_detections / etc. At LSP scale (thousands of rows in active factories), CLN datastore would force application-level index synthesis in C against a KV store. Wrong tool.

The established CLN-plugin pattern for substantial state is **plugin-owned SQLite**:

| Plugin | Storage |
|---|---|
| clboss (auto-pilot) | own sqlite3 |
| emergency-recovery | own sqlite3 |
| csvexpenses / historian | own sqlite3 |
| summary | datastore (because tiny state) |

SuperScalar's state shape puts it firmly in the "own SQLite" bucket. The plugin's data dir goes under `$lightning_dir/`, so operator backup story = back up `~/.lightning/` = covers everything.

#### Concrete deployment shape

```
$lightning_dir/
├── hsm_secret
├── lightningd.sqlite3                    ← CLN's own
├── plugins/
│   └── superscalar-cln                   ← our plugin
└── superscalar/                          ← our state, plugin-managed
    └── state.db                          ← libsuperscalar's existing SQLite
                                             (same file the standalone LSP uses)
```

The plugin opens `state.db` on startup via libsuperscalar's `persist.c` API. The watchtower opens the same file in WAL mode for concurrent reads. The dashboard reads it too. Everyone shares one canonical store.

#### What this eliminates

This single decision **obviates two previously-tracked tasks:**

- ~~Task #63: `state_source_cln_datastore` adapter for the watchtower~~ — no longer needed; watchtower reads the same SQLite the plugin writes
- ~~Task #64: full libsuperscalar embed in plugin~~ — this IS the new default, not a future phase

It also **deletes ~600 lines from the plugin** — the parallel persistence implementation (`ss_persist_serialize_*`, `ss_save_outgoing_joins`, the per-factory datastore writes) is replaced by direct calls to libsuperscalar's `persist.c` API.

#### Migration path

One-shot migration on plugin upgrade: read existing CLN datastore entries (`superscalar/factories`, `superscalar/outgoing-joins`, `superscalar/<iid>/...`), write to the new SQLite via libsuperscalar, then clear the datastore entries. After migration, CLN datastore holds nothing SuperScalar-related — everything lives in SQLite.

Tracked as **Task #72 (Phase 4 prereq: persistence pivot)**.

#### Why I had this wrong initially

I overweighted "CLN datastore is LN-native" without honestly evaluating the data shape. clboss, emergency-recovery, and other production CLN plugins doing this exact pattern proves the precedent is well-established. CLN itself uses SQLite (`lightningd.sqlite3`) for its own state. There's nothing un-LN about a plugin doing the same.

### Key decisions captured

- **Preflight balance check bundled into Phase 4**, not done first. Phases 2-3 are wire-only with no on-chain spend, so preflight isn't needed yet. Phase 4 is when ceremonies fire and `withdraw` is called — preflight lands in the same PR so on-chain re-entry and the safety net arrive together. No window of unsafe behavior.
- **No lib-team message needed for the `factory_session_finalize_node` incident.** Traced to operator error (over-ask), not a lib bug. CLN's `withdraw` correctly refused. The single historic April 25 occurrence is from a 3-of-3 REALLOC ceremony, unrelated to recent work; flagged internally for context if it recurs.
- **Lib stays wallet-blind by design.** Matches libsecp256k1 / libwally / LDK precedent. The integration layer (plugin) enforces balance + feerate. Wallet UI does pre-validation for UX polish. The lib only contributes structural math (tree shape → vsize, if it ever adds that helper).
- **Plugin-side fixes folded into Phase 4 PR:**
  - Pre-flight balance check via CLN `listfunds` at the top of all 9 funding RPCs
  - Optional `feerate_perkw` parameter so wallet/operator can honor signet (0.1 sat/vb)
  - Surface plugin's `**BROKEN**` log entries back through JSON-RPC response instead of only into the log file
  - Cleaner ceremony-failure reasons exposed to caller

### Signet test infrastructure (verified working)

| Component | State | Notes |
|---|---|---|
| `cln-signet-c` (LSP, test-lsp-c, `03493661…`) | Running fork v25.12.1-58-g6442f9f + plugin loaded | bit 271 advertised, factory RPCs registered |
| `cln-signet-d` (client, test-client-d, `02e07e9a…`) | Running fork v25.12.1-58-g6442f9f + plugin loaded | bit 271 advertised, factory RPCs registered |
| Peer connection between them | Persistent | Already done bidirectional `supported_factory_protocols` handshake |
| Wallet balance on signet-c | 99,834 confirmed + 49,679 unconfirmed | Note: 306 sat lost over policy to the 1M-sat over-ask retest (lesson learned) |
| Plugin binary on VPS | Apr 29 build from `gap9-keyagg-cache-persistence@c107d0c` | Should rebuild from `main` when plugin team merges that branch — TBD |

### Outstanding handoffs

| Recipient | What | Status |
|---|---|---|
| Lib team | nothing | No action needed |
| Plugin team (when not me) | Confirm canonical branch (`main` vs `gap9-keyagg-cache-persistence`) before I base browse/join PRs | Pending response |
| Fork team | nothing | PR #3 merged into deploy |
| Operator (you) | Schedule sub-channel open via `factory-open-channels` for factory `b5579e70...` once signet confirms its funding tx, if desired | Optional — proves end-to-end works on chain |

### Memory rules in effect (saved in user's auto-memory)

- Signet operations must use 0.1 sat/vbyte (`feerate=100perkw`); never lose sats
- My scope: lib↔plugin↔wallet↔bLIP-56 adapter analysis + plugin + wallet implementation (NOT lib code, NOT dashboard rewrite)
- Plugin uses ODD 33001 not EVEN 32800 — documented deviation

---

## Cross-references

- `docs/PROTOCOL_V1.md` (also unmerged) — the polished spec equivalent
- `docs/FACTORY_POLICY_V1.md` (also unmerged) — what *values* travel through this protocol
- `superscalar-cln/CONFORMANCE.md` — bLIP-56 substrate deviation log
- `superscalar-cln/ceremony.h` — all existing SS_SUBMSG_* IDs
- `8144225309/lightning` `blip-56` branch — fork-level bLIP-56 changes
