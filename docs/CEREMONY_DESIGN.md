# SuperScalar Ceremony Design

**Status:** draft for review · 2026-05-17 · author: plugin team
**Audience:** SuperScalar lib developers, superscalar-cln plugin developers, superscalar-wallet developers, third-party wallet authors planning to integrate

This document specifies multi-party signing ceremonies in the SuperScalar plugin. It covers when ceremonies happen, how they are initiated, what wire messages they use, how state is persisted across crashes, the sequencing invariants that prevent the dual-signature trap, and how unattended signing works so users don't have to be online for every epoch boundary.

A **ceremony** is the multi-round cryptographic exchange where the LSP plus accepted participants co-sign one or more factory transactions using MuSig2. The MuSig2 primitives themselves (nonce derivation, partial signing, aggregation) live in `libsuperscalar` and in the plugin's `nonce_exchange.c`. This document is about the **calling convention** — when the plugin starts a ceremony, what it sends, how it tracks responses, how participants validate before signing, and how decisions get made automatically vs. via the wallet.

---

## 1. Scope

### In scope (v1)

- Four ceremony types: `INITIAL`, `ROTATE`, `FORCE_OUT`, `ABORT`. (Penalty/burn TX broadcasts are *not* a ceremony — see §4.6.)
- New wire submsgs 0x0145–0x014C with a type discriminator for the ceremony kind.
- New plugin lifecycle states between `INIT` and `CEREMONY_IN_PROGRESS`.
- Persistence of in-flight ceremony state so a crashed plugin resumes mid-flight.
- Sequencing invariants enforced by both plugin and wallet.
- Unattended signing infrastructure (auto-sign policy, notification fallback).

### Reserved for v2 (codes pre-assigned, not yet implemented)

`JOIN`, `LEAVE`, `CLOSE`, `DISTRIBUTION_UPDATE`, `STATE_UPDATE`.

### Out of scope

- The MuSig2 math (lib).
- Wallet UI rendering of these flows (wallet team's separate work).
- Channel-level BOLT-2 commitment updates (leaf-internal, do not involve factory-wide ceremonies).

---

## 2. Architectural principles

### 2.1 Mechanism in plugin, policy advertised and enforced everywhere

The plugin owns mechanism: send signing requests, collect nonces and partial sigs, aggregate, broadcast, persist, retry, timeout, auto-sign per configured policy. The plugin has no opinions about whether a particular ceremony *should* happen at a high level — that's the operator's call (manual RPC) or the scheduler's call (epoch-boundary auto-trigger).

The wallet owns *user-facing* policy decisions and the UI. The plugin DB owns *enforcement-relevant* policy state (auto-sign preferences, operator settings) so that signing decisions can proceed when the wallet is offline.

### 2.2 Two-track factory model: create-then-trigger

A factory is built in two distinct operator-facing steps:

1. **`factory-create`** — declares intent to host a factory with a specific policy. Allocates a `factory_instance_t`, records the policy as the contract, advertises via `FACTORY_INFO_RESPONSE` to discovery queries. Transitions `LIFECYCLE_INIT → LIFECYCLE_AWAITING_JOINS`. **Does not initiate any signing or fund anything on-chain.**

2. **`factory-trigger-ceremony type=INITIAL`** — fires the actual ceremony. Funds the on-chain TX from the LSP's wallet, runs MuSig2 tree-signing with the accepted participants in `join_queue`. Transitions `LIFECYCLE_AWAITING_JOINS → LIFECYCLE_CEREMONY_IN_PROGRESS → LIFECYCLE_ACTIVE`.

Between these two steps clients run the JOIN flow (existing 0x0142/0x0143) to opt into the factory. The `min_clients_to_start` policy (kept LSP-private; see §3) governs whether the LSP fires manually or waits.

**The previous inline `factory-create clients=[...]` form is removed in v1.** No back-compat warning path; tests are updated to the canonical create-then-trigger pattern.

### 2.3 Just send, not ask

The default communication pattern for in-protocol operations is "LSP sends the signing request with TX templates; participant validates and either responds with a nonce or stays silent." There is **no separate ack/announcement round** before signing rounds.

The exception is JOIN (already implemented as 0x0142/0x0143): when a participant is *first joining* a factory, the LSP asks before doing any work because there's no prior consent to participate. Once a participant is in the factory, all subsequent ceremonies are "just send" — the participant validates each request against policy and decides whether to sign.

This matches BOLT-2 channel behavior, where commitment updates are pushed without a separate handshake.

### 2.4 Validation by content, not by ack

A participant doesn't need to "agree" to a ceremony before nonce exchange. Instead, the participant **validates the TX templates** in `CEREMONY_START` and only sends a nonce reply if the templates match its understanding of the factory's policy. Silence (or an explicit `REFUSED` reply) is a valid response.

### 2.5 Three state machines, layered by responsibility

| State machine | Layer | Owner |
|---|---|---|
| Factory lifecycle (`CREATED → AWAITING_JOINS → READY_TO_TRIGGER → CEREMONY_IN_PROGRESS → ACTIVE → ROTATING → DYING → CLOSED`) | Plugin / lib | Plugin code, persisted in libsuperscalar SQLite |
| Ceremony lifecycle per in-flight ceremony (`PENDING_NONCES → NONCES_AGGREGATED → PENDING_SIGS → FINALIZED \| ABORTED \| PARTIAL_FAILED`) | Plugin | Plugin code, persisted in `ceremonies` table |
| Wallet UI state (which screen, which factory selected, etc.) | Wallet TS | Not protocol-relevant |

The plugin's two state machines are the protocol authority. The wallet reads them via RPC; it doesn't maintain a parallel copy.

---

## 3. Storage architecture

The system has **two SQL databases** with a clean separation of responsibility, plus tiny localStorage for UI prefs. The wallet backend daemon is co-deployed with CLN — they boot together, run together, shut down together. So "wallet offline while CLN online" is not a real scenario in this design.

### 3.1 Two databases, by responsibility

| Database | File | Owner | What it holds |
|---|---|---|---|
| **libsuperscalar SQLite** | `$lightning_dir/superscalar/state.db` | Lib team | Crypto state, factory tree, ceremony state, revocation receipts, watchtower data. **Zero policy bytes.** |
| **Wallet SQLite** | `<wallet-app-data>/wallet.db` | Wallet team (each wallet implementation has its own) | Factory policy snapshots, LSP operator policies, client signing policies, peer notes, reputation, custom join rules, factory display preferences |

This split keeps the lib **policy-blind**. The lib does crypto correctly; the wallet provides all the policy that the crypto operates on. Same architectural pattern as LDK: library handles primitives, caller owns policy.

### 3.2 What lives where, in detail

**The rule:** if it would still need to exist in a hypothetical "factories without MuSig" universe, it belongs in the wallet. If it only exists because of the cryptographic protocol, it belongs in the lib.

**libsuperscalar SQLite — crypto state + the bookkeeping the crypto needs:**

- Tree state (channels, tree nodes, leaves)
- Signed transactions (funding, distribution, leaves, burns)
- Revocation secrets + receipts
- Ceremony tables: in-flight multi-party signing state (`ceremonies`, `ceremony_participants`, `revocation_releases`)
- Watchtower data (force-close watches, breach detections, broadcast log)
- HTLC state, old commitments (revoked-state ledger)
- Anything that exists *only because of MuSig2/Decker-Wattenhofer*

**Wallet SQLite — server/client coordination + policy + user-domain:**

- Factory list from the user's perspective: which factories I host, which I joined, my role per factory, display labels
- LSP-side join queue: who's asked to join the factories I host, their JOIN_REQUEST state, accept/decide bookkeeping
- Client-side outgoing joins: which factories I've sent JOIN_REQUEST to, their state
- IID counter (monotonic counter for HSM-derived instance IDs; lib provides the derivation function, wallet manages the counter)
- Factory policy snapshots: one row per factory, the TLV-encoded policy as agreed at JOIN time. Wallet validates ceremonies against these.
- LSP operator preferences (auto-rotate cadence, banlist entries, hidden min_clients_to_start, force-out timing)
- Client signing preferences (auto-sign rules per factory, allocation-change thresholds, notification routing)
- Peer notes, reputation, custom join filters
- Anything else wallet-domain

**Wallet TS-frontend localStorage — UI-only prefs:**

- Theme, layout, last-viewed screen.
- Tiny — typically <1 KB.

**CLN datastore — nearly unused for SuperScalar concerns.**

- Possibly a single startup-role flag. Otherwise empty.

### 3.3 Decision flow when a wire message arrives

Because the wallet daemon is always co-running with CLN, every signing decision is real-time:

```
Wire: CEREMONY_START arrives at superscalar-cln plugin
   |
   v
Plugin: persists ceremony row + participant phase=SENT (lib SQLite, durability for crash recovery)
   |
   v
Plugin: notifies wallet daemon via RPC
   |
   v
Wallet: queries its own SQLite — factory's policy snapshot, signing prefs, last-finalized-ceremony tracker
   |
   v
Wallet: validates proposed TX templates against agreed policy; checks sequencing invariants
   |
   v
Wallet: decides (auto-sign | prompt user via UI | refuse)
   |
   v
Wallet → plugin RPC: "sign" or "refuse code X"
   |
   v
Plugin: invokes lib's MuSig2 helpers, persists phase=NONCED then SIGNED before aggregating
   |
   v
Plugin → peer: NONCE_REPLY then PARTIAL_SIG
```

The wallet is the decision-maker at every step. The lib does crypto. The plugin is the thin glue. No durable policy cache needed in the lib — the wallet daemon is always there to consult.

### 3.4 The one operational nuance: plugin-boot window

When CLN restarts, both the plugin (CLN subprocess) and the wallet daemon (separate systemd/launchd service) come up. Order isn't deterministic. For a few seconds during boot, one might be up while the other isn't.

Handling: **plugin refuses all incoming ceremonies during boot until the wallet handshakes ready** via a one-time `factory-wallet-ready` RPC call. Plugin returns `SS_ERR_NODE_BOOTING` (new error code) to any wire message until ready. Peers retransmit after their own timeouts; no message loss in practice because boot windows are typically a few seconds.

This avoids the need for plugin-resident policy cache. The plugin doesn't make autonomous decisions; it just queues for the wallet.

### 3.5 Architecture diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  User's machine (or LSP server)                                      │
│                                                                       │
│  ┌──────────────────────────────────────────────┐                    │
│  │  Wallet TS app (soupwallet or any other)      │                    │
│  │                                                │                    │
│  │  Wallet SQLite (per-install file):             │                    │
│  │   • factory_list (user's role per factory)     │                    │
│  │   • lsp_join_queues, outgoing_joins            │                    │
│  │   • iid_counter                                │                    │
│  │   • factory_policy_snapshots                   │                    │
│  │   • lsp_operator_prefs, client_signing_prefs  │                    │
│  │   • peer_notes, reputation, custom_rules       │                    │
│  │                                                │                    │
│  │  Tiny localStorage: UI prefs only              │                    │
│  └──────────────────────┬───────────────────────┘                    │
│                          │                                            │
│                          │ CLN JSON-RPC                                │
│                          ▼                                            │
│  ┌──────────────────────────────────────────────┐                    │
│  │  lightningd (CLN daemon)                       │                    │
│  │                                                │                    │
│  │  ┌──────────────────────────────────────────┐ │                    │
│  │  │  superscalar plugin                       │ │                    │
│  │  │                                            │ │                    │
│  │  │  Storage: libsuperscalar SQLite           │ │ ← single source    │
│  │  │  at $lightning_dir/superscalar/state.db   │ │   of truth for     │
│  │  │                                            │ │   ALL protocol     │
│  │  │  Tables (crypto state + ceremony round    │ │   state            │
│  │  │   bookkeeping ONLY):                       │ │                    │
│  │  │   • factories  (crypto params only)        │ │                    │
│  │  │   • channels, tree_nodes                   │ │                    │
│  │  │   • ceremonies                             │ │                    │
│  │  │   • ceremony_participants                  │ │                    │
│  │  │   • revocation_releases                    │ │                    │
│  │  │   • signed transactions, breach data       │ │                    │
│  │  │   (no policy, no join queues, no           │ │                    │
│  │  │    coordination state — wallet owns those) │ │                    │
│  │  │                                            │ │                    │
│  │  │  Exposes RPCs (the public API for wallets) │ │                    │
│  │  └──────────────────────────────────────────┘ │                    │
│  └──────────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.6 Multiple wallets pointing at one node

If a user runs multiple wallets (e.g., soupwallet on desktop + a future mobile companion) against the same node, both wallets see the same factories, same balances, same in-flight ceremonies, because they're both reading the same plugin DB via the same RPC surface. Each wallet has its own local UI prefs. The plugin is the shared backend; wallets are interchangeable frontends.

This matches the LN ecosystem norm: an LND node can simultaneously serve Zeus and ThunderHub. A CLN node can simultaneously serve soupwallet and RTL.

### 3.6 Why this matters for other wallet authors

The plugin's RPC surface is the **public API** for wallets. No wallet ever touches the plugin's SQLite directly. If the plugin DB schema changes, the RPC stays stable; wallet code keeps working.

If you're writing a new wallet for SuperScalar, the recipe is:

1. Read the plugin's RPC documentation.
2. Build your UI to consume those RPCs.
3. Store only wallet-local UI prefs in your wallet's own storage.
4. Treat any plugin state your UI caches as cache only — rebuildable from RPC.

---

## 4. Ceremony types

### 4.1 The v1 set plus reserved codes

| Type byte | Name                  | Tier   | v1?   | Trigger                                            |
|-----------|-----------------------|--------|-------|----------------------------------------------------|
| 0x01      | `INITIAL`             | A      | yes   | Operator RPC (after JOIN flow collects clients)    |
| 0x02      | `ROTATE`              | A      | yes   | Scheduled (epoch boundary) or operator RPC         |
| 0x03      | `JOIN`                | A      | later | Operator RPC after JOIN queue threshold            |
| 0x04      | `LEAVE`               | B      | later | Participant-initiated departure                    |
| 0x05      | `FORCE_OUT`           | A      | yes   | Operator RPC after participant non-response        |
| 0x06      | `CLOSE`               | A      | later | Operator RPC                                       |
| 0x07      | `DISTRIBUTION_UPDATE` | B      | later | Operator RPC (Tier B allocation rebalance)         |
| 0x08      | `STATE_UPDATE`        | B      | later | State pressure (pseudo-Spilman state count)        |
| 0x0A      | `ABORT`               | n/a    | yes   | Either side cancels                                |

(Type byte 0x09 reserved/unused. Penalty/burn TXs are pre-signed during INITIAL/ROTATE and broadcast by the watchtower on trigger — not a separate ceremony type. See §4.6.)

### 4.2 Tier A vs Tier B clarification

**Tier A** = full-tree wakeup. All N participants are required to sign. Examples: factory creation, full rotation at epoch boundary, close, force-out (because the tree shape changes).

**Tier B** = partial-tree wakeup. Only the affected subset of participants signs. Encompasses leaf-level changes (single channel allocation), subtree-level rotations (one branch's counter rolling over), pseudo-Spilman state advances, allocation rebalances among existing participants.

The `allow_tier_b_rollover` policy flag (FACTORY_POLICY_V1 §4.7.5) globally enables or disables Tier B operations for a factory. Default `true` (Tier B allowed for efficiency). An operator who wants the maximum anti-collusion margin sets it `false`, forcing all changes to be full-tree.

### 4.3 INITIAL ceremony (hybrid)

INITIAL is special because the on-chain funding TX is funded entirely from the LSP's wallet and signed with a normal SegWit signature — no MuSig2 there. MuSig2 only kicks in for the tree TXs (distribution, leaves, burns, state) downstream of the funding output.

Flow:

1. LSP collects accepted participants via the existing JOIN flow.
2. Operator calls `factory-trigger-ceremony type=INITIAL`.
3. Plugin funds the on-chain TX via CLN's `withdraw` RPC.
4. Plugin transitions factory to `CEREMONY_IN_PROGRESS` and sends `CEREMONY_START` (type=INITIAL) to each accepted participant.
5. Standard two-round MuSig2 dance (sections 6 and 8).
6. Plugin records the tree TXs as the factory's signed contract state.

This is why JOIN matters as the gate: the LSP does not commit on-chain funding fees until participants are confirmed willing to MuSig the tree.

### 4.4 ROTATE ceremony

ROTATE re-signs the existing tree at an epoch boundary with fresh keys. The participant set is unchanged. Old revocation secrets are released as part of the ceremony.

Triggers:

- **Scheduled**: block-height-based, both sides know the boundary is coming, no `CEREMONY_START` announcement is unusual.
- **Manual**: operator decides "we should rotate now" (e.g., suspicious activity, planned policy change).

### 4.5 FORCE_OUT ceremony

FORCE_OUT excludes a participant who failed to respond in a prior ceremony. The remaining participants re-sign the tree without the excluded party's leaf; their share is redistributed per policy (typically back to LSP reserve, or split among remaining participants).

This is the operator's response when a participant goes dark. Triggers manually via `factory-trigger-ceremony type=FORCE_OUT excluded_pubkey=...`. The wallet of the excluded participant cannot block this — they had their chance to respond.

### 4.6 Penalty/burn TX broadcasts (NOT a ceremony)

Earlier drafts treated PENALTY_BURN as its own ceremony type. **Corrected after lib-team review (2026-05-18).** Penalty/burn TXs are not signed at breach time — they are pre-signed during the normal leaf-state-advance ceremony (which is part of INITIAL or ROTATE) using N-of-N MuSig over LSP + ALL clients of that leaf, key-path spend. The signed bytes sit on disk in libsuperscalar SQLite as crypto artifacts of the leaf-advance ceremony.

When a breach is detected (LSP publishes a stale leaf state), the watchtower:

1. Observes the stale state on-chain
2. Looks up the corresponding pre-signed poison/burn TX in libsuperscalar SQLite
3. Broadcasts the existing signed bytes

No multi-party signing happens at burn time. No `CEREMONY_START` flies. No type-byte 0x09 needed.

Implementation references (libsuperscalar):

- L-stock SPK construction: `src/factory.c:239` (`build_l_stock_spk`)
- Poison/burn TX spending: `src/factory.c:3154` (`sign_l_stock_spend_with_outputs`) — N-of-N MuSig key-path
- Equal-split poison logic: `src/factory.c:3241` (`factory_sign_l_stock_poison_tx`)

The watchtower's role for penalty broadcasts is the same primitive used by issue #28 (auto-sweep) and #10 (subscriptions): hold pre-signed bytes, broadcast on trigger. One mechanism, multiple consumers.

(The "breaching participant" is a misnomer — the breaching party doesn't actually sign the burn that punishes them. The naming reflects that the burn's tapscript binds those two pubkeys; one of them, in practice the LSP, holds the punishing keys. The lib team has a code-reference snippet they'll send showing the actual mechanism.)

### 4.7 ABORT

ABORT cancels an in-flight ceremony. Either side can send it. Carries the ceremony_id and a reason byte. On receipt, both sides release in-progress state and revert to "no ceremony in flight" for that factory.

ABORT is critical because a stuck ceremony blocks all further ceremonies for that factory (per the sequencing invariant in §6). Both sides must trust that ABORT messages are authentic — relying on BOLT-8 transport authentication, already provided by CLN's wire encryption.

**Important:** an ABORTED ceremony does NOT become a valid `parent_ceremony_id`. The next ceremony's parent reference is the same one the aborted ceremony used (the prior FINALIZED ceremony or 0 for INITIAL).

---

## 5. Wire submsg codes

All ceremony submsgs carry a 64-bit `ceremony_id` (random, like the existing `request_id` for browse/join) so resumes match originals and out-of-order delivery can be reassembled.

| Code   | Name                       | Direction         | Payload                                                              |
|--------|----------------------------|-------------------|----------------------------------------------------------------------|
| 0x0145 | `CEREMONY_START`           | LSP → Participant | ceremony_id, type, factory_instance_id, parent_ceremony_id, TX templates, LSP public nonce, deadline_block, deadline_epoch_seconds |
| 0x0146 | `CEREMONY_NONCE_REPLY`     | Participant → LSP | ceremony_id, participant public nonce, OR refuse_code                |
| 0x0147 | `CEREMONY_PARTIAL_SIG_REQ` | LSP → Participant | ceremony_id, aggregated nonce, message hashes                        |
| 0x0148 | `CEREMONY_PARTIAL_SIG`     | Participant → LSP | ceremony_id, partial signatures, revocation secrets being released   |
| 0x0149 | `CEREMONY_RESULT`          | LSP → Participant | ceremony_id, final aggregated sig, txid (if broadcast), confirmation status |
| 0x014A | `CEREMONY_ABORT`           | either direction  | ceremony_id, abort_reason_code                                       |
| 0x014B | `CEREMONY_STATUS_QUERY`    | Participant → LSP | ceremony_id (for crash-recovery resync)                              |
| 0x014C | `CEREMONY_STATUS_REPLY`    | LSP → Participant | ceremony_id, current phase, expected-next-message-from-this-participant |

Type byte values in 0x0145 are listed in §4.1. Refuse codes in 0x0146:

```
0x01 = unrecognized factory (participant has no JOIN history for this instance_id)
0x02 = policy violation: TX template not consistent with agreed factory policy
0x03 = policy violation: allocation/state change exceeds local auto-sign threshold
0x04 = sequencing violation: parent_ceremony_id does not match last finalized
0x05 = participant temporarily unavailable (retry later)
0x06 = wallet user explicitly refused (after notification, plugin asked, user said no)
0xFF = unspecified refusal
```

Abort reason codes in 0x014A:

```
0x01 = timeout: not enough participants responded by deadline
0x02 = participant detected protocol violation
0x03 = operator manual abort
0x04 = on-chain conflict (underlying state changed)
0x05 = revocation secret missing or invalid
0xFF = unspecified
```

---

## 6. The sequencing safety invariants (load-bearing)

The naive "wallet signs anything that fits policy" implementation is unsafe. A partial signature is **implicitly an authorization for the LSP to broadcast that specific outcome**.

If the wallet signs ceremony A (epoch N → N+1, participants {Alice, Bob, Carol}) and also signs ceremony B (epoch N → N+1, participants {Alice, Bob, Dave}) without finalizing A first, the LSP holds signatures for two mutually exclusive futures. The LSP picks whichever is worse for the wallet's user.

This is the same reason BOLT-2 channels require strict sequencing: only one pending commitment per channel at a time; revoke the old before signing the new; no two in flight.

### 6.1 Invariant 1: one in-flight ceremony per factory at a time

**Plugin side:** maintains a per-factory in-flight ceremony_id pointer. While non-null and the ceremony is not finalized or aborted, plugin refuses to start a new ceremony for the same factory. Returns `SS_ERR_CEREMONY_IN_PROGRESS`.

**Wallet side:** the plugin DB tracks "what's in flight for this factory from MY participant perspective." When the plugin receives a `CEREMONY_START` for a factory that already has an in-flight ceremony in its own record, it refuses with code 0x04 (sequencing violation). The plugin does not trust the LSP's claim — it verifies against its own records.

### 6.2 Invariant 2: parent linking

Every `CEREMONY_START` carries a `parent_ceremony_id` field — the ceremony_id of the previous *finalized* ceremony for this factory, or `0` if it's the first ceremony after factory creation.

Plugin verifies that `parent_ceremony_id` matches the last finalized ceremony in its own records. Mismatch → refuse with code 0x04.

This catches a class of attacks where the LSP tries to skip or rewrite a step in the history — e.g., "ignore ceremony Y that we did, and use X as the parent for Z" — which could let the LSP equivocate about the factory's state.

### 6.3 Invariant 3: revocation gating

A ceremony B for epoch N → N+1 can only follow a finalized ceremony A for the same boundary if A was *fully* finalized — meaning all participants (including the wallet's user) released revocation secrets for the state A replaced.

Without revocation, A is stuck in a "could still be broadcast" zombie state where someone holds a valid old state plus its signatures. If B then happens, the wallet has signed two contradictory worlds and the LSP picks.

The plugin tracks per-state revocation receipts in the `revocation_releases` table. A ceremony is not finalized until all expected revocations for the prior state are recorded and verified.

### 6.4 Crash-recovery durability

Both invariants must survive plugin crashes. If the plugin loses its in-flight tracker on restart, an attacker LSP could exploit the gap to bind a second signature.

**The implementation rule from the lib team (Caveat 2 in §13):**

> Write `phase=SIGNED` to `ceremony_participants` BEFORE the plugin moves to aggregation. Read on startup.

The plugin persists each state transition BEFORE acting on it: persists `phase=SENT` before sending `CEREMONY_START`, persists `phase=NONCED` before computing aggregated nonce, persists `phase=SIGNED` before counting the participant toward finalization. On crash, restart reads disk state and resumes with whatever was durably recorded — never assumes anything in-memory.

Similarly the wallet's "what policy did I agree to at JOIN" and "what's in-flight from my perspective" must be durable in the plugin DB before the wallet sends `CEREMONY_NONCE_REPLY`.

---

## 7. Persistence schema

All in-flight ceremony state lives in the libsuperscalar SQLite database at `$lightning_dir/superscalar/state.db`. Tables added in v34 migration (PR #252, already landed). No further policy-shaped tables are needed in the lib — the wallet's own SQLite owns all policy state (per §3).

### 7.1 Existing v34 tables

**`ceremonies`** — one row per ceremony (in-flight or historical).

```sql
CREATE TABLE ceremonies (
    ceremony_id           BLOB PRIMARY KEY,   -- 8 bytes, random
    factory_instance_id   BLOB NOT NULL,      -- 32 bytes
    ceremony_type         INTEGER NOT NULL,   -- 0x01=INITIAL, 0x02=ROTATE, ...
    parent_ceremony_id    BLOB,               -- nullable for INITIAL after factory creation
    started_at_block      INTEGER NOT NULL,
    deadline_block        INTEGER NOT NULL,
    deadline_epoch_secs   INTEGER NOT NULL,   -- redundant; for wallet UI
    state                 INTEGER NOT NULL,
    aggregated_nonce      BLOB,               -- populated when state >= NONCES_AGGREGATED
    final_signature       BLOB,               -- populated when state == FINALIZED
    broadcast_txid        BLOB,               -- populated when state == FINALIZED AND broadcast successful
    abort_reason          INTEGER             -- populated when state == ABORTED
);
CREATE INDEX idx_ceremonies_factory ON ceremonies(factory_instance_id, state);
```

State enum: `0=PENDING_NONCES`, `1=NONCES_AGGREGATED`, `2=PENDING_SIGS`, `3=FINALIZED`, `4=ABORTED`, `5=PARTIAL_FAILED`.

**`ceremony_participants`** — one row per (ceremony × participant).

```sql
CREATE TABLE ceremony_participants (
    ceremony_id           BLOB NOT NULL,
    participant_pubkey    BLOB NOT NULL,      -- 33 bytes
    phase                 INTEGER NOT NULL,   -- 0=NOT_SENT, 1=SENT, 2=NONCED, 3=SIGNED, 4=TIMED_OUT, 5=REFUSED
    public_nonce          BLOB,               -- populated when phase >= NONCED
    partial_signature     BLOB,               -- populated when phase >= SIGNED
    refuse_code           INTEGER,            -- populated when phase == REFUSED
    last_sent_at          INTEGER,            -- unix timestamp; for retry timing
    PRIMARY KEY (ceremony_id, participant_pubkey)
);
```

**`revocation_releases`** — one row per (factory × state × participant).

```sql
CREATE TABLE revocation_releases (
    factory_instance_id   BLOB NOT NULL,
    state_id              BLOB NOT NULL,      -- which state's revocation
    participant_pubkey    BLOB NOT NULL,
    revocation_secret     BLOB NOT NULL,      -- 32 bytes
    received_at_block     INTEGER NOT NULL,
    PRIMARY KEY (factory_instance_id, state_id, participant_pubkey)
);
```

### 7.2 No new lib tables for policy

Earlier drafts of this doc proposed `lsp_operator_prefs` and `client_signing_prefs` tables in libsuperscalar SQLite. **Removed in 2026-05-18 revision.**

Reason: the wallet daemon is co-deployed with CLN and always available to make decisions in real-time. The plugin never needs to consult policy autonomously; it always asks the wallet. So no policy bytes ever need to live in the lib's schema.

These tables now live in the **wallet's own SQLite** (per §3.2). The lib stays purely policy-blind.

### 7.3 Crash recovery procedure

On plugin startup:

1. Scan `ceremonies` for rows where `state` is `PENDING_NONCES` or `PENDING_SIGS`.
2. For each in-flight ceremony, load all matching `ceremony_participants` rows.
3. For participants in `SENT` or `NONCED` phase, resend the appropriate submsg with the **same** ceremony_id (counterpart wallet recognizes it as a resume).
4. Participants in `SIGNED` or `TIMED_OUT` are skipped (their state is durably recorded).
5. If `deadline_block` has passed and not enough participants are `SIGNED`, transition the ceremony to `PARTIAL_FAILED` or `ABORTED` per the operator's policy (`auto_partial_finalize` setting).

The wallet's resume behavior: on startup, the plugin sends `CEREMONY_STATUS_QUERY` to the LSP for any ceremony marked in-flight from this participant's perspective. LSP responds with the canonical state; both sides converge.

---

## 8. Real-time wallet-mediated signing

The wallet daemon is co-deployed with CLN; both run as long-lived services on the same machine. Every signing decision happens in real-time via plugin → wallet RPC, with the wallet consulting its own SQLite for policy.

### 8.1 The decision flow

When a `CEREMONY_START` arrives at the plugin:

1. Plugin persists ceremony row + participant phase=SENT to libsuperscalar SQLite. (Durability for crash recovery, not for autonomous decisions.)
2. Plugin invokes a wallet RPC (e.g., `wallet-ceremony-incoming`) passing the ceremony_id, type, factory_id, parent_ceremony_id, and TX templates.
3. Wallet consults its own SQLite:
   - Factory policy snapshot for this factory (what was agreed at JOIN)
   - Last-finalized-ceremony_id for this factory (sequencing invariant check)
   - Client signing prefs for this factory (auto-sign rules for this ceremony type)
4. Wallet validates the proposed TX templates against the policy snapshot. If any invariant fails (sequencing, parent_ceremony_id mismatch, policy violation), wallet returns refuse with the appropriate code.
5. Wallet decides per signing prefs:
   - **Auto-sign:** wallet returns "sign" to plugin immediately.
   - **Prompt user:** wallet emits a UI notification (toast, system notification, etc.). Waits for user approval up to the ceremony deadline. On approve → "sign". On refuse or timeout → refuse with appropriate code.
6. Plugin executes per wallet's decision via lib helpers.
7. Plugin persists each phase transition (SENT → NONCED → SIGNED) BEFORE moving to the next round, per lib-team Caveat 2 (§13.2).

### 8.2 Where the auto-sign policy lives

The wallet's SQLite holds tables like:

```sql
CREATE TABLE client_signing_prefs (
    factory_instance_id   BLOB NOT NULL,
    pref_key              TEXT NOT NULL,
    pref_value            TEXT NOT NULL,   -- JSON-encoded
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (factory_instance_id, pref_key)
);
```

Example pref keys:

- `auto_sign_scheduled_rotations` (bool)
- `auto_sign_tier_b_rollovers` (bool)
- `max_allocation_change_sats_auto_sign` (u64)
- `require_user_confirmation_for_force_out` (bool)
- `notification_method` (enum)

These tables live in the **wallet's SQLite**, not the lib's. The plugin doesn't see them; it only asks the wallet "should I sign this?" and the wallet figures out the answer using its own state.

### 8.3 Per-ceremony-type defaults

If no explicit pref is set for a factory, the wallet uses these defaults:

- `INITIAL` — never auto-sign; always prompt (this is the user's first commitment to a factory; deserves explicit attention).
- `ROTATE` (scheduled, at expected block) — auto-sign if user has not overridden.
- `ROTATE` (unscheduled, operator-initiated) — never auto-sign; always prompt.
- `FORCE_OUT` — never auto-sign; always prompt (excluding a participant is serious).
- (PENALTY_BURN is not a ceremony — see §4.6. Watchtower broadcasts pre-signed bytes; no signing decision needed at trigger time.)
- `DISTRIBUTION_UPDATE` (Tier B) — auto-sign if change magnitude ≤ a configurable threshold; otherwise prompt.

The wallet can let users override any of these per-factory.

### 8.4 Plugin boot window (one operational nuance)

When CLN starts, the plugin (CLN subprocess) comes up before the wallet daemon finishes its own startup. For a few seconds, the plugin is up but the wallet isn't reachable.

Handling: plugin refuses incoming ceremonies during this window with `SS_ERR_NODE_BOOTING`. Wallet does a one-time handshake on startup (`factory-wallet-ready` RPC) signaling availability. Plugin then processes normally. Peers retransmit any messages received during the boot window.

No durable policy cache in the lib needed. Just startup-sequencing.

---

## 9. Canonical flows

### 9.1 INITIAL ceremony

```
Pre-INITIAL (existing):
  Each prospective client → LSP:  0x0142 JOIN_REQUEST
  LSP → client:                   0x0143 JOIN_RESPONSE (accepted)
  ... repeats until threshold

INITIAL trigger:
  Operator → plugin (LSP-side):   factory-trigger-ceremony type=INITIAL instance_id=...
  Plugin checks: lifecycle == AWAITING_JOINS, n_accepted >= effective_min, no in-flight ceremony.
  Plugin persists: new row in ceremonies (state=PENDING_NONCES), one row per participant
                    in ceremony_participants (phase=NOT_SENT).
  Plugin → CLN:                    withdraw RPC (funds on-chain TX with funding_sats + fee)
  Plugin: ← funding txid

Phase 1 — nonce round:
  Plugin updates each participant phase NOT_SENT → SENT, PERSISTS, then sends:
  Plugin → each participant:      0x0145 CEREMONY_START
                                    (type=INITIAL, ceremony_id, parent=0,
                                     factory_instance_id, tree TX templates,
                                     LSP nonce, deadline_block, deadline_epoch_secs)

  Each participant plugin validates (sequence, policy, signing prefs). Either auto-sign
  or pause for user approval. If signing:
  Participant → LSP:              0x0146 CEREMONY_NONCE_REPLY (ceremony_id, participant nonce)

  LSP plugin: updates each participant phase SENT → NONCED, PERSISTS each transition.

Phase 2 — aggregation:
  Plugin (when all nonces in OR deadline passed AND quorum met):
  Plugin: computes aggregated nonce, message hashes.
  Plugin: PERSISTS aggregated_nonce, transitions ceremonies.state PENDING_NONCES → PENDING_SIGS.

Phase 3 — sig round:
  Plugin → each NONCED participant: 0x0147 CEREMONY_PARTIAL_SIG_REQ (aggregated nonce, message hashes)

  Participant plugin validates message hashes match locally-recomputed values from templates.
  Participant computes partial sig.
  Participant → LSP:               0x0148 CEREMONY_PARTIAL_SIG (ceremony_id, partial sig)
                                    (no revocation secrets here — INITIAL has no prior state)

  LSP plugin: PERSISTS each participant phase NONCED → SIGNED.

Phase 4 — finalization:
  Plugin aggregates partial sigs into final Schnorr signature.
  Plugin stores final sig in tree TX templates (off-chain — these become the factory's
  signed contract state; not necessarily broadcast).
  Plugin: PERSISTS ceremonies.state PENDING_SIGS → FINALIZED, final_signature, broadcast_txid.
  Plugin → all participants:       0x0149 CEREMONY_RESULT (final sig, status=OK)
  Plugin: factory lifecycle CEREMONY_IN_PROGRESS → ACTIVE.
```

### 9.2 ROTATE ceremony (scheduled, auto-fired)

Identical structure to INITIAL except:

- No JOIN phase; participants are already known.
- No `withdraw` step.
- `parent_ceremony_id` is non-zero — the prior finalized ceremony.
- TX templates request revocation for the previous state.
- Participants release revocation secrets in `CEREMONY_PARTIAL_SIG`.
- Plugin records each revocation in `revocation_releases` and refuses to finalize until all expected revocations are received and the lib's `rev_secret · G == rev_pubkey` check passes.

Trigger:

```
At each block_added notification, plugin scans active factories:
  for each factory in ss_state.factories where lifecycle == ACTIVE:
    if is_rotation_due(factory, current_block):
      if factory has no in-flight ceremony:
        auto-trigger ROTATE (per operator's auto_rotate_cadence_blocks)
      else:
        log audit event (rotation due but ceremony in flight; will retry next block)
```

`is_rotation_due()` consults the factory's policy fields `auto_rotate_periodically`, `rotation_interval_blocks`, `expected_rotation_blocks`.

### 9.3 FORCE_OUT ceremony

```
Operator → plugin: factory-trigger-ceremony type=FORCE_OUT instance_id=... excluded_pubkey=...
Plugin checks: factory is ACTIVE, no in-flight ceremony, excluded participant has missed >= N ceremonies.
Plugin: persists new ceremony row, ceremony_participants for remaining participants.
                                  (excluded participant is NOT in ceremony_participants)
Plugin → remaining participants:  0x0145 CEREMONY_START (type=FORCE_OUT, ...)

Each remaining participant validates: this is a legitimate FORCE_OUT (per their signing-prefs
policy on FORCE_OUT auto-sign behavior), excluded participant's pubkey matches what they
remember as silent.

[remaining flow as ROTATE — nonce round, aggregate, sig round, finalization]

Plugin: factory's join_queue marks excluded_pubkey as DEPARTED.
Plugin: tree shape rebuilt without excluded participant's leaf.
```

### 9.4 Penalty/burn TX broadcast (NOT a ceremony — broadcast only)

```
At leaf-state-advance time (during INITIAL or ROTATE ceremony):
  Plugin computes burn TXs for each possible stale-state outcome.
  Plugin collects N-of-N MuSig partial sigs from LSP + all leaf signers.
  Plugin aggregates into final Schnorr sig (key-path spend).
  Plugin persists signed bytes to libsuperscalar SQLite as crypto artifacts.
  → These TXs are now "armed" — pre-signed and ready, sitting on disk.

When LSP later broadcasts a stale leaf state (the breach):
  Watchtower observes the stale state via chain scan.
  Watchtower looks up the corresponding pre-signed burn TX bytes.
  Watchtower broadcasts the bytes on-chain.
  → No multi-party signing happens. No CEREMONY_START flies. No coordination needed.

Post-broadcast (informational, optional):
  Watchtower may notify the LSP plugin via internal channel that a burn fired.
  Plugin may emit an audit-log event so wallets can show "factory had a breach
  attempt; burn was broadcast."
```

The watchtower's broadcast role here is the same primitive used by issue #28 (auto-sweep) and #10 (subscriptions). See §4.6 for implementation references.

### 9.5 Crash mid-flight, then recover

```
T0: Plugin in PENDING_SIGS phase. A and B have phase=SIGNED, C has phase=SENT.
    All three persisted to disk.

T1: Plugin crashes.

T2: Plugin restarts.
T3: Plugin scans ceremonies. Finds ceremony X in PENDING_SIGS state.
T4: Plugin scans ceremony_participants for X:
      A: SIGNED — skip
      B: SIGNED — skip
      C: SENT — resend 0x0145 CEREMONY_START with same ceremony_id
T5: C's plugin receives the resend. Looks up ceremony X locally. Recognizes resume.
    Responds with previously-computed nonce (also persisted on its side) or computes
    fresh if not yet sent. In either case continues normally.
T6: Plugin proceeds, finalizes.
```

---

## 10. Deadline semantics

### 10.1 Both blocks and seconds, blocks canonical

Internal storage uses `deadline_block` as the authoritative form. Wire submsg 0x0145 carries both `deadline_block` (absolute) and `deadline_epoch_secs` (also absolute). The wallet UI can use either.

### 10.2 Input forms

`factory-trigger-ceremony` accepts EITHER:

- `deadline_block` (absolute block height), OR
- `deadline_seconds_from_now` (relative seconds — plugin converts to block using `current_blockheight + ceil(seconds / mean_block_secs_for_network)`)

If both are supplied, the FIRST to expire wins.

### 10.3 Network-specific mean block time

| Network  | Mean block time |
|----------|-----------------|
| mainnet  | 600 s           |
| signet   | 600 s           |
| testnet4 | 600 s           |
| regtest  | configurable via lightningd config |

### 10.4 Drift handling

Block-height is the authority. The `deadline_epoch_secs` is computed once at `CEREMONY_START` send time as `current_unix_time + (deadline_block - current_blockheight) × mean_block_secs`. It will drift relative to actual block production but is only used for UX display. The plugin's reaper uses `deadline_block` exclusively.

---

## 11. Failure modes and operator controls

### 11.1 Insufficient participants

If by `deadline_block` fewer than the required quorum are `SIGNED`, the ceremony transitions to `PARTIAL_FAILED`. The operator has three options:

1. **Abort** — send `CEREMONY_ABORT` to all participants, roll back to prior factory state.
2. **Force-out non-responders + new ceremony** — start a FORCE_OUT ceremony with the responding subset.
3. **Wait longer** — extend the deadline (only valid if ceremony has not yet been ABORTED).

Exposed via:

- `factory-ceremony-abort ceremony_id=... reason_code=...`
- `factory-trigger-ceremony type=FORCE_OUT ...` (which implicitly resolves the prior partial)
- `factory-ceremony-extend-deadline ceremony_id=... new_deadline_block=...`

### 11.2 Participant refuses

A wallet that returns a `refuse_code` in `CEREMONY_NONCE_REPLY` signals it considers the ceremony invalid. The plugin (LSP side) logs an audit event (`ceremony_refused`, see Task #70 audit helper) with the refuse code and continues with the remaining participants. If insufficient remain, falls into §11.1.

### 11.3 LSP misbehavior

The participant's defenses against a malicious LSP:

- Validate every TX template against the factory's policy snapshot.
- Enforce `parent_ceremony_id` matching (§6.2).
- Enforce one-in-flight-per-factory (§6.1).
- Refuse to release revocation secrets except as part of `CEREMONY_PARTIAL_SIG` for a ceremony that has reached PENDING_SIGS phase (so the LSP can't extract secrets ahead of time).
- All of these enforced by the participant's own plugin against its own DB.

### 11.4 Stuck ceremony

If a ceremony stays in `PENDING_NONCES` or `PENDING_SIGS` past its deadline AND no operator action is taken, the plugin's reaper (every 5s tick) transitions it to `PARTIAL_FAILED` and emits an audit event. The factory returns to whatever its prior lifecycle state was.

### 11.5 Concurrent ceremonies across factories

The one-in-flight invariant is **per-factory**. An LSP running 100 factories may legitimately have 100 concurrent ceremonies. The global cap (`--superscalar-max-concurrent-ceremonies`, default 32) prevents state-table exhaustion as a DoS-resistance measure.

---

## 12. Tricky edge cases

### 12.1 Same-block re-rotation after abort

If a ROTATE ceremony aborts at block H due to insufficient participants, the LSP immediately triggers another ROTATE at block H+1. **The aborted ceremony does NOT become a valid `parent_ceremony_id`.** The new ROTATE's parent reference is the same as the aborted one's — the prior FINALIZED ceremony (or 0 for the first rotation after INITIAL).

This is enforced by `parent_ceremony_id` validation: wallets only accept FINALIZED ceremonies as a parent. Aborted ones are dead.

### 12.2 Concurrent INITIAL crash recovery

If the plugin crashes after the on-chain funding TX is broadcast but tree-signing is incomplete:

- The funding TX is durable on-chain (or will reorg out — see step 3).
- The tree TXs are unsigned.

On startup, the plugin:

1. Scans `ceremonies` for ceremony in `PENDING_*` state with `ceremony_type=INITIAL`.
2. Checks the chain for the funding TX (via `listfunds` or `getblockhash + getblock` cycle). If confirmed, resume tree-signing exactly as §9.5.
3. If the funding TX has vanished (reorg, or never confirmed), abort the ceremony and reclaim the funding through normal CLN wallet operations.

### 12.3 Unknown parent_ceremony_id (fresh wallet)

A participant whose wallet is fresh (or restored from backup) doesn't have the local ceremony history. When the LSP sends `CEREMONY_START` with a `parent_ceremony_id` the participant has never seen:

1. The participant runs a discovery phase first: queries `factory-list` + `factory-ceremony-list` from its own plugin (which should have the history from prior signing rounds) BEFORE participating in any new ceremony.
2. If the history is genuinely absent (true fresh state from backup with no plugin DB), the wallet must do a full state-recovery procedure: query the LSP via `CEREMONY_STATUS_QUERY` for the canonical ceremony chain, validate via on-chain checkpoints, then rebuild local state.
3. Until recovery completes, the participant refuses any new ceremony with code 0x04.

### 12.4 Operator triggers ceremony when factory in wrong state

E.g., factory is `CEREMONY_IN_PROGRESS`, or `DYING`. Plugin returns:

- `SS_ERR_CEREMONY_IN_PROGRESS` (2280) — if ceremony already in flight.
- `SS_ERR_FACTORY_LIFECYCLE_INVALID` (new, 2287) — if factory is in a state that doesn't accept this ceremony type (e.g., `DYING` and operator asks for `JOIN`).

### 12.5 Scheduled rotations with `auto_rotate_periodically=false`

If a factory's policy has `auto_rotate_periodically=false`, the plugin does NOT auto-fire at epoch boundaries. Rotations only happen via manual `factory-trigger-ceremony type=ROTATE`. "Scheduled" in our doc has a narrower meaning when this flag is off — it means "operator-scheduled," not plugin-scheduled.

---

## 13. Lib-team caveats

Two implementation-critical caveats from the libsuperscalar team's coordination reply (2026-05-17).

### 13.1 Caveat 1: keyagg ordering varies by leaf type

When the plugin derives the per-state revocation pubkey for `revocation_releases`, the MuSig2 keyagg ordering varies by leaf type:

- **PS leaves**: `[LSP, client]` + `node_cltv`
- **non-PS leaves**: `[client, LSP]` + `factory_cltv`

**Never hardcode an order.** Always call `channel_discover_funding_keyagg` (lib-provided helper) to fetch the right ordering before computing the pubkey to insert.

### 13.2 Caveat 2: phase-write-before-aggregate (load-bearing)

The dual-signature trap is prevented at the implementation level by a strict disk-write ordering rule:

> Write `phase=SIGNED` to `ceremony_participants` BEFORE the plugin moves to aggregation. Read on startup.

The plugin persists each participant phase transition BEFORE acting on it. On crash, restart reads disk state and resumes with whatever was durably recorded — never assumes anything in-memory. Without this exact ordering, a crash mid-aggregation could allow the plugin to re-ask the same participant to sign a different TX for the same epoch boundary.

This is the implementation contract that makes §6.4 actually work.

---

## 14. New plugin RPCs

| RPC                                       | Purpose                                                          |
|-------------------------------------------|------------------------------------------------------------------|
| `factory-trigger-ceremony`                | Operator-initiated ceremony start. Params: instance_id, type, deadline_block_offset (optional), excluded_pubkey (for FORCE_OUT). |
| `factory-ceremony-status`                 | Inspect in-flight ceremony state. Params: instance_id or ceremony_id. |
| `factory-ceremony-abort`                  | Operator-initiated abort. Params: ceremony_id, reason_code.      |
| `factory-ceremony-extend-deadline`        | Push the deadline_block out. Params: ceremony_id, new_deadline.  |
| `factory-ceremony-list`                   | List all ceremonies (in-flight + recent finalized) for a factory.|
| `factory-ceremony-approve`                | Wallet calls this when user approves a pending notification. Params: ceremony_id. |
| `factory-wallet-ready`                    | Wallet daemon calls this at startup to signal availability; plugin stops returning SS_ERR_NODE_BOOTING. |

These land in subsequent Phase 4 follow-up PRs after this design is approved.

---

## 15. Error codes

Extending the taxonomy from Task #69 (PR #55, merged) with the new ceremony-lifecycle codes:

```
SS_ERR_CEREMONY_IN_PROGRESS              = 2280
SS_ERR_CEREMONY_NOT_FOUND                = 2281
SS_ERR_CEREMONY_PARENT_MISMATCH          = 2282
SS_ERR_CEREMONY_DEADLINE_PASSED          = 2283
SS_ERR_CEREMONY_INVALID_TYPE             = 2284
SS_ERR_CEREMONY_INSUFFICIENT_PARTICIPANTS = 2285
SS_ERR_CEREMONY_REVOCATION_MISSING       = 2286
SS_ERR_FACTORY_LIFECYCLE_INVALID         = 2287
SS_ERR_CEREMONY_USER_DECLINED            = 2288
```

Add to `ERROR_CODES.md` in the same PR that introduces them.

---

## 16. Guidance for third-party wallet authors

If you're writing a wallet UI that participates in SuperScalar factories on someone else's CLN node, the recipe:

1. **Use the plugin's RPC surface.** That's the public API.
2. **Do not touch the plugin's SQLite directly.** That's a private implementation detail.
3. **Store only wallet-local UI prefs in your own storage.** Anything you might be tempted to cache from plugin state is rebuildable via RPC — treat it as a cache, not authority.
4. **Configure signing policy in your wallet daemon's SQLite.** The plugin will call your wallet RPC at every ceremony; your wallet decides per its own policy. Your wallet daemon must be co-deployed with CLN as a long-lived service.
5. **Subscribe to plugin notifications.** When the plugin determines a ceremony needs user approval, it emits a CLN notification. Your wallet listens for these (existing CLN plugin notification mechanism) and prompts the user. Approve via `factory-ceremony-approve`.
6. **Persist the user's preferences via RPC, not in your wallet.** This way if the user later switches wallets (or runs two wallets simultaneously), their preferences stay consistent.

Following this pattern makes your wallet interoperable with the standard SuperScalar setup. Other wallets following the same pattern can simultaneously run against the same node without conflict.

---

## 17. Open questions

A short list of items intentionally not yet decided in this draft:

1. **Notification fallback semantics for offline wallets.** v1 ships with CLN-plugin-notification + audit log. Whether to add webhook/email fallback is operationally driven.
2. **Recovery procedure for genuinely-fresh wallets restoring from seed.** Specified at a high level in §12.3 but needs a detailed procedure in a future doc.
3. **Wallet-team-owned design questions** (out of scope for this doc): exact wallet SQLite schema, push-vs-pull policy update flow, multi-wallet coordination if same node serves multiple UIs.

---

## 18. Implementation roadmap

PR-by-PR breakdown, each independently mergeable:

1. **PR 1 (lib team) — persist_* helpers.** Plugin-side wrappers over the v34 ceremony tables. No new policy tables in the lib; the wallet handles policy.
2. **PR 2 (plugin) — wire codec.** Add encode/decode for 0x0145–0x014C submsgs and the type byte. No state machine. Unit tests over codec.
3. **PR 3 (plugin) — sequencing-safe state machine.** Add `LIFECYCLE_AWAITING_JOINS`, `LIFECYCLE_READY_TO_TRIGGER` to factory_lifecycle_t. Implement ceremony state transitions with the persist-phase-before-aggregate discipline. INITIAL ceremony path only.
4. **PR 4 (plugin) — crash recovery.** Implement startup scan, resume logic, `CEREMONY_STATUS_QUERY/REPLY`.
5. **PR 5 (plugin) — ROTATE ceremony + revocation handling.** Adds rotation path with revocation_releases integration.
6. **PR 6 (plugin) — FORCE_OUT and ABORT.**
7. **PR 7 (plugin) — Penalty broadcast plumbing.** Wire the watchtower's existing breach-broadcast role into the ceremony state machine for audit/notification. NOT a new ceremony — the burn TXs are already signed during INITIAL/ROTATE. See §4.6.
8. **PR 8 (plugin) — Unattended-signing infrastructure.** `factory-set-client-signing-pref`, `factory-set-operator-pref`, `factory-ceremony-approve`, and the auto-sign decision tree.
9. **PR 9 (plugin) — Operator RPCs.** `factory-trigger-ceremony`, `factory-ceremony-status`, `factory-ceremony-abort`, etc.
10. **PR 10 (plugin) — `factory-create` contract change.** Remove inline `clients=[...]` form; update test suite to canonical create-then-trigger.

Wallet-side UI work for PRs 3–10 is tracked separately by the wallet team.

---

End of design document.
