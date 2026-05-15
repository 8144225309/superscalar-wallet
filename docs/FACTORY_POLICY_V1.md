# Factory Policy Specification v1

**Status:** Draft (2026-05-14)
**Schema version:** 1
**Audience:** SuperScalar lib developers, superscalar-cln plugin developers, superscalar-wallet developers
**Intended destination:** `superscalar-docs/deep-dives/factory-policy.md` once aligned, plus a normative copy in `8144225309/SuperScalar/docs/`

---

## 1. Purpose

A factory's **policy** is the set of rules its participants agree to at creation time. Three roles enforce the policy locally; one role advertises it; one role renders it.

Today (2026-05-14) most of these rules either:
- exist only in the LSP wallet's `localStorage` (operator intent without runtime enforcement),
- are hardcoded in the lib (not configurable),
- emerged from recent code changes (PR #159 / CL series / PS canonical shift) without a unified type,
- or don't exist yet but are implied by the system's design.

This spec consolidates them into one **versioned, TLV-encoded, schema-versioned `ss_factory_policy_t`** that:

- Lives in the SuperScalar C library as a canonical type.
- Is enforced by the LSP, the client, and the watchtower at every signing point.
- Is advertised by the LSP to prospective joiners over LN (via bLIP-56 `factory_piggyback`) when asked.
- Is rendered by wallets so users can decide whether to join.

---

## 2. Scope and non-goals

### In scope

- The data structure: which fields, what types, what defaults, what ranges, mutability rules.
- The wire format: TLV-diff-from-defaults, encoded inside bLIP-56 `factory_piggyback` payload.
- The plugin RPC response shape: JSON schema for `factory-list-public`.
- Enforcement points: who checks each field, when, and what they do on violation.
- Versioning: how `schema_version` evolves; forward/backward compatibility rules.

### Not in scope

- The wire protocol for **requesting** the policy. That's a separate submsg pair (`SS_SUBMSG_FACTORY_INFO_REQUEST` / `SS_SUBMSG_FACTORY_INFO_RESPONSE`) defined in the bLIP-56 / SuperScalar wire spec.
- The plugin's join-acceptance handshake. Separate ceremony spec.
- Wallet-local user preferences ("I only join factories with fee ≤ X"). Those are render-time filters on already-received policy data, not part of this contract.
- LSP-operator-only preferences (e.g., ladder scheduling decisions distinct from joiner-relevant cadence). Those live in a separate `ss_lsp_operator_prefs_t` struct, not advertised, not bound by this contract. (Note: `auto_host_next`, `ladder_cadence_blocks`, and `auto_rotate_periodically` — previously thought to be in this bucket — are actually joiner-relevant soft commitments and DO appear in policy per §4.13.)
- bLIP-56 itself. This spec lives one layer above bLIP-56 — bLIP-56 is the envelope, factory policy is one specific payload that envelope can carry.
- **The SuperScalar lib's internal data model.** The lib has no concept of "policy" — it accepts discrete parameters via CLI flags + `ss_config_t` + factory/watchtower construction-arg structs. The policy struct, validators, and TLV codec live in the **plugin's source tree only**. See §7 and §12 for the layer split.

---

## 3. Architecture

```
                  superscalar-cln plugin (canonical type lives here)
                                    |
                                    | ss_factory_policy_t
                                    | (struct + defaults + validators + TLV codec
                                    |  — ALL in plugin's source tree, not the lib)
                                    |
              +---------------------+---------------------+----------------+
              |                     |                     |                |
              v                     v                     v                v
        Validates at         Validates at        Populates lib    Advertises over LN
        every LSP-side       every client-side   config structs   via factory_piggyback
        sign point           sign point          at each call     (TLV diff from defaults)
              |                     |                  site               |
              |                     |                  |                  |
              +-----+               +-----+            v                  v
                    |                     |     SuperScalar lib    bLIP-56 envelope
                    | (joiner-side        |     (no policy concept;  over LN noise
                    |  validation         |     receives discrete    to peer plugin
                    |  refuses violations |     parameters via CLI         |
                    |  per §7.1)          |     flags + ss_config_t        v
                    v                     v     + ss_factory_create_args   Peer plugin
                                                + ss_watchtower_config)    decodes diff
                                                          |                       |
                                                          v                       v
                                                  Lib does what          (Peer's plugin
                                                  it's told. The         returns full policy
                                                  lib WT module          to peer's wallet
                                                  references             via factory-list-public
                                                  policy-derived         RPC)
                                                  params at runtime              |
                                                  to build correct               v
                                                  penalty TX shape.        Wallet renders
                                                                           in Connect tab
              |  via factory-list-public RPC)
              v
        Wallet renders fields in Connect tab row
              |
              v
        User decides whether to join, with
        their own local filter preferences applied
        (filter logic is wallet-local, not on wire)
```

### Three forms the policy takes

| Form | Carrier | When |
|---|---|---|
| **In-memory struct** (`ss_factory_policy_t`) | Plugin source tree only (NOT the lib) | Runtime |
| **TLV diff** (only fields differing from defaults) | bLIP-56 `factory_piggyback` payload over LN | Joiner discovery |
| **Full JSON** (all fields, defaults expanded) | Plugin RPC response (`factory-list-public`) | Wallet rendering |
| **Discrete CLI flags + lib config struct fields** | `ss_config_t`, `ss_factory_create_args_t`, `ss_watchtower_config_t` populated by the plugin from policy at each lib-call site | Runtime, internal to lib invocations |

### 3.1 Signer counts per ceremony × arity_mode

The number of signers required for each ceremony type varies by `arity_mode`. This drives the per-client online-cadence expectation and is a key input to the wallet's "required reachability" UX synthesis.

| Ceremony | DW `ARITY_1` | DW `ARITY_2` | PS canonical `ARITY_PS` | How often |
|---|---|---|---|---|
| Factory creation | LSP + ALL N | LSP + ALL N | LSP + ALL N | Once at inception |
| Cooperative close | LSP + ALL N | LSP + ALL N | LSP + ALL N | Once at wind-down |
| Per-client liquidity allocation on their leaf | LSP + 1 (just that client) | LSP + 2 (client + leaf-mate) | **LSP + 1** | Per sale |
| PS chain advance (`factory-ps-advance`) | N/A | N/A | **LSP + 1** | Per advance |
| DW rotation, leaf level | LSP + 1 | LSP + 2 | **LSP + 1** | Per epoch advance affecting that leaf |
| DW rotation, subtree level (inner counter carry) | LSP + clients in subtree (~N/K) | LSP + clients in subtree | LSP + clients in subtree | Every K epochs (rare) |
| DW rotation, root level (carry-from-subtree-exhaustion) | LSP + ALL N | LSP + ALL N | LSP + ALL N | Every K^N epochs (very rare) |
| Migration / PTLC assisted exit | LSP + 1 (departing client) | LSP + 1 | LSP + 1 | Per departing client, during dying period |

**Key insight:** in PS canonical, a client's required participation is almost entirely independent of other clients' state changes. Alice doesn't sign Bob's liquidity-sale ceremonies; only her own leaf's events. This is the wide-leaf k² advantage — clients are decoupled.

**Async-ceremony property:** within any one ceremony, signers do not need to be online simultaneously. The MuSig2 round-trips are sequential through the LSP coordinator, and each signer's "online time" is just the moments they receive a message and respond. The hard requirement is that each signer responds within `confirm_timeout_sec` of the LSP's PROPOSE (default 24h).

**Wallet UX implication — "required reachability":** wallets should compute a derived metric per factory:

```
Per-client reachability cadence = MIN(
    dying_period_blocks,                            // for migration
    rotation_interval_blocks if auto_rotate_periodically else infinity,  // for periodic rotations
    client's own liquidity-change frequency         // operator-chosen, not advertised
)

Maximum tolerated unreachable window per event = confirm_timeout_sec
```

UI prompt: *"Be reachable at least every X days, with up to 24h response window each time."*

---

## 4. Field specification

Every field has the same attribute set:

- **TLV ID** — stable u16 identifier for wire diff format
- **Type** — Rust/C-style primitive
- **Default** — value when not explicitly set
- **Range** — valid bounds
- **Mutability** — `immutable` (locked at creation, signed into tree) | `mutable_lsp_only` (LSP can change without re-consent) | `mutable_with_consent` (requires ceremony)
- **Joiner-relevant** — `advertised` (must appear in policy diff) | `lsp_only` (never on wire)
- **Enforcement strength** — `hard` | `soft` | `joiner_enforceable_hard` (see §4.0.1 below)
- **Enforced at** — code path(s) that check the field
- **Enforced by** — `lib` / `plugin` / `watchtower` / `wallet`
- **On violation** — what happens when a check fails

### 4.0.1 Enforcement strength taxonomy

Policy fields differ in how strongly they're enforced. Three levels:

| Level | Definition | What stops a violation |
|---|---|---|
| **hard** | Cryptographically locked. The value is part of what gets signed into the factory's transactions (tree CLTV, allocation math, HTLC checks). | Mathematical impossibility — the relevant tx would have an invalid signature |
| **joiner_enforceable_hard** | LSP-side is soft (operator could attempt to violate), but the joiner's client software validates each proposal and refuses to sign violations. | Client-side refusal during ceremony |
| **soft** | Advertised commitment with no cryptographic backing. Honored by the LSP's well-behaved plugin code; not technically enforceable. | Reputation; joiners walking away |

A field's strength flows from what part of the system observes it:
- If the field shapes the **signed tree** (e.g., `lifetime_blocks`) → `hard`
- If the field appears in **per-ceremony validation** by both LSP AND joiner → `joiner_enforceable_hard`
- If the field describes **LSP operator behavior** without entering ceremony validation → `soft`

**Wire format does NOT transmit enforcement strength.** It's a property of the spec, not the data. Receivers infer it from §4.0.2 lookup table. This keeps the wire diff minimal while letting wallets render trust posture per-field.

### 4.0.2 Field-to-strength lookup

| Strength | Fields |
|---|---|
| `hard` | `schema_version`, `protocol_id`, `lifetime_blocks`, `dying_period_blocks`, `block_early_count`, `confirm_timeout_sec`, `arity_mode`, `leaf_arity`, `leaf_channel_type`, `ps_subfactory_arity`, `epoch_count`, `n_layers`, `dw_step_blocks`, `static_near_root_layers`, `per_client_capacity_sat`, `lsp_reserve_per_leaf_sat`, `lsp_initial_balance_pct`, `max_accepted_htlcs` |
| `joiner_enforceable_hard` | `htlc_min_sat`, `htlc_max_sat`, `max_concurrent_htlcs_per_channel`, `max_in_flight_msat_per_channel`, `min_final_cltv_expiry_delta`, `cltv_expiry_delta_forward`, `min_capacity_per_join_sat`, `max_capacity_per_join_sat`, `rotation_interval_blocks`, `allow_tier_b_rollover`, `state_replay_defense_window_blocks` |
| `soft` | `allow_bolt12`, `allow_amp`, `allow_blinded_paths`, `auto_accept_joiners`, `banlist`, `allowlist`, `auto_finalize_on_dying`, `joiner_admission_window_blocks`, `watchtower_mode`, `poison_tx_strategy`, `breach_response_fee_rate_sat_per_kvb`, `wt_startup_scan_depth_blocks`, `reorg_alarm_depth_blocks`, `reorg_response_strategy`, `advance_dust_warning_threshold_sat`, `fee_rate_strategy`, `min_fee_rate_sat_per_kvb`, `migration_paths_supported`, `allow_splice`, `allow_jit_fallback`, `forward_fee_policy`, `forward_fee_base_msat`, `forward_fee_ppm`, `lsp_self_routing_allowed`, `auto_host_next`, `ladder_cadence_blocks`, `auto_rotate_periodically`, `expected_rotation_blocks` |

### 4.0.3 TLV ID ranges

Partitioned by category for forward-compat:

| Range | Category |
|---|---|
| 0x0000–0x00FF | Schema / protocol |
| 0x0100–0x01FF | Tree shape |
| 0x0200–0x02FF | Lifecycle |
| 0x0300–0x03FF | Economics |
| 0x0400–0x04FF | Channel options |
| 0x0500–0x05FF | HTLC policy |
| 0x0600–0x06FF | Joiner admission |
| 0x0700–0x07FF | Watchtower policy |
| 0x0800–0x08FF | PS chain policy |
| 0x0900–0x09FF | Fee policy |
| 0x0A00–0x0AFF | Migration policy |
| 0x0B00–0x0BFF | Routing / forwarding policy |
| 0x0C00–0x0CFF | Lifecycle commitments |

Gaps are intentional — v2 fields can fit between existing IDs without renumbering.

---

### 4.1 Schema / protocol (2 fields)

#### 4.1.1 `schema_version`

| Attribute | Value |
|---|---|
| TLV ID | 0x0000 |
| Type | u32 |
| Default | 1 |
| Range | ≥ 1 |
| Mutability | immutable |
| Joiner-relevant | advertised (ALWAYS — first field in every diff) |
| Enforced at | TLV decoder |
| Enforced by | lib |
| On violation | unknown version → return `policy_schema_unsupported` error; refuse interaction |

Version of this policy schema. v1 = this document. Future v2 may add, deprecate, or reinterpret fields. **Receivers MUST refuse policies with `schema_version` they don't recognize.**

#### 4.1.2 `protocol_id`

| Attribute | Value |
|---|---|
| TLV ID | 0x0001 |
| Type | byte[32] |
| Default | `"SuperScalar/v1"` zero-padded to 32B |
| Range | (any 32 bytes; receivers must match against their accepted set) |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | bLIP-56 piggyback dispatch |
| Enforced by | plugin |
| On violation | mismatch → drop message; do not process |

Echoes the `factory_protocol_id` of the bLIP-56 envelope. Repeated here so the policy is self-describing when stored offline.

---

### 4.2 Tree shape (8 fields)

#### 4.2.1 `arity_mode`

| Attribute | Value |
|---|---|
| TLV ID | 0x0100 |
| Type | enum u8 |
| Default | `ARITY_PS` (post-PS-canonical shift; was `AUTO` before PR #159) |
| Range | `AUTO = 0`, `ARITY_1 = 1`, `ARITY_2 = 2`, `ARITY_PS = 3` |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | tree builder (`src/factory.c`), MuSig2 ceremony (all signers must agree) |
| Enforced by | lib + client |
| On violation | ceremony abort with `arity_mismatch` |

The leaf topology family. `ARITY_PS` activates the pseudo-Spilman wide-leaf k² shape; `ARITY_1` and `ARITY_2` are pure Decker-Wattenhofer.

#### 4.2.2 `leaf_arity`

| Attribute | Value |
|---|---|
| TLV ID | 0x0101 |
| Type | u8 |
| Default | 2 |
| Range | 1, 2, 4, 8 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | tree builder, ceremony |
| Enforced by | lib |
| On violation | construction fails with `unsupported_leaf_arity` |

Number of clients per leaf when `arity_mode != ARITY_PS`. Ignored if `arity_mode == ARITY_PS` (PS canonical uses 1 client per leaf with k² wide-leaf structure).

#### 4.2.3 `leaf_channel_type`

| Attribute | Value |
|---|---|
| TLV ID | 0x0102 |
| Type | enum u8 |
| Default | `PSEUDO_SPILMAN = 1` |
| Range | `LN_PENALTY = 0`, `PSEUDO_SPILMAN = 1` |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | tree builder, MuSig2 ceremony |
| Enforced by | lib + client |
| On violation | ceremony abort |

`LN_PENALTY` = standard Poon-Dryja with revocation. `PSEUDO_SPILMAN` = the recommended type with chained leaf advances. PR #11 default is `PSEUDO_SPILMAN`.

#### 4.2.4 `ps_subfactory_arity`

| Attribute | Value |
|---|---|
| TLV ID | 0x0103 |
| Type | u8 |
| Default | 2 |
| Range | 2, 4 |
| Mutability | immutable |
| Joiner-relevant | advertised (only meaningful when `arity_mode == ARITY_PS`) |
| Enforced at | tree builder |
| Enforced by | lib |
| On violation | construction fails |

The k in k² wide-leaf shape. With `ps_subfactory_arity = 2`, each wide leaf hosts 2² = 4 channels per sub-factory. PR #159 introduced campaign coverage for k=2 and k=4.

#### 4.2.5 `epoch_count`

| Attribute | Value |
|---|---|
| TLV ID | 0x0104 |
| Type | u16 |
| Default | 16 |
| Range | 2 – 256 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | DW odometer (`src/dw_state.c`) |
| Enforced by | lib |
| On violation | exhaustion triggers migration (not an error per se, but the LSP must rotate) |

Total number of rotations the factory supports. With `dw_step_blocks = 144` and `n_layers = 2`, default is K^N = 4² = 16. v1 lib derives the K and N factorization automatically from `epoch_count`.

#### 4.2.6 `n_layers`

| Attribute | Value |
|---|---|
| TLV ID | 0x0105 |
| Type | u8 |
| Default | 2 |
| Range | 1 – 3 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | DW odometer, tree builder |
| Enforced by | lib |
| On violation | construction fails |

Number of stacked DW layers. Each layer adds ~3 days to the worst-case unilateral exit. 2 is the default; 3 is used when more epochs are needed at the cost of CLTV budget.

#### 4.2.7 `dw_step_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0106 |
| Type | u16 |
| Default | 144 |
| Range | 36 – 432 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | DW odometer, nSequence builder |
| Enforced by | lib |
| On violation | construction fails |

The decrement per state in BIP-68 blocks. Default 144 (~1 day). Smaller = faster final-state confirmation but tighter timing margin.

#### 4.2.8 `static_near_root_layers`

| Attribute | Value |
|---|---|
| TLV ID | 0x0107 |
| Type | u8 |
| Default | 0 |
| Range | 0 – 2 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | tree builder, MuSig2 ceremony |
| Enforced by | lib |
| On violation | construction fails |

Number of top tree layers that never rotate. Reduces memory pressure on long-lived factories. Most v1 deployments leave at 0.

---

### 4.3 Lifecycle (4 fields)

#### 4.3.1 `lifetime_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0200 |
| Type | u32 |
| Default | 4320 (≈ 30 days at 144 blocks/day) |
| Range | 144 – 525960 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | factory CLTV in distribution TX nLockTime |
| Enforced by | lib (at signing time), node (at broadcast time) |
| On violation | CLTV is signed into the tree; cannot be violated |

The active period during which the factory accepts state changes. After this, the factory enters dying period.

#### 4.3.2 `dying_period_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0201 |
| Type | u32 |
| Default | 288 (≈ 2 days) |
| Range | 72 – 4320 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | plugin `block_added` hook |
| Enforced by | plugin |
| On violation | lifecycle transitions automatically based on chain height |

Window during which clients can perform migration / assisted exit / cooperative close before the factory's CLTV timeout fires.

#### 4.3.3 `block_early_count`

| Attribute | Value |
|---|---|
| TLV ID | 0x0202 |
| Type | u16 |
| Default | 144 (≈ 1 day) |
| Range | 36 – 4032 |
| Mutability | immutable |
| Joiner-relevant | advertised (matches TLV 65600's `factory_early_warning_time` on the wire) |
| Enforced at | plugin `htlc_accepted` hook, channeld CLTV check on factory channels |
| Enforced by | plugin (today; should be CLN-fork-native per audit) |
| On violation | reject HTLC with `incorrect_cltv_expiry` |

How many blocks before factory CLTV timeout the LSP must start unilateral exit. Equals the `factory_early_warning_time` field of bLIP-56 TLV 65600. Inflates invoice `min_final_cltv_expiry_delta` and route CLTV deltas.

#### 4.3.4 `confirm_timeout_sec`

| Attribute | Value |
|---|---|
| TLV ID | 0x0203 |
| Type | u32 |
| Default | 86400 (24 hours) |
| Range | 60 – 604800 (1 minute to 7 days) |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | lib ceremony timeout, plugin block-tick |
| Enforced by | lib + plugin |
| On violation | factory creation aborts; in-flight rotation marks as failed |

How long the LSP waits for client signatures on a state advance before giving up and aborting the ceremony. Joiners can be impatient (low value) or patient (high value).

**This timeout applies independently per ceremony, not globally.** A factory with multiple concurrent ceremonies (e.g., two different leaves having simultaneous liquidity sales) runs an independent timer per ceremony — clients involved in only one ceremony don't need to be reachable across the others. The clock starts when the LSP broadcasts the initial PROPOSE message and stops when the LSP either has all signatures or aborts. MuSig2 itself is asynchronous: signers do not need to be online at the same time as each other — only within this timeout window relative to the LSP's broadcast.

---

### 4.4 Economics (5 fields)

**Revenue model — v1 is pure-routing.** The LSP earns from per-HTLC forwarding fees (`forward_fee_*` in §4.12), not from any one-time setup fee at admission. Capacity moves from L-stock to a client's A&L channel for free; the LSP recoups capital cost via routing fee accumulation over the factory's lifetime. This matches the Phoenix-style LSP model. Earlier drafts of this spec included `lsp_fee_sat`/`lsp_fee_ppm`/`join_fee_sat` (one-time setup fees); they were removed in draft 4 because (a) no SuperScalar CLI flag implements them today and (b) the lib has no setup-fee accounting infrastructure. Operators wanting one-time setup fees are a v2 design question.

#### 4.4.1 `per_client_capacity_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0300 |
| Type | u64 |
| Default | 100000 |
| Range | 10000 – 100000000 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | allocation builder, MuSig2 ceremony |
| Enforced by | plugin |
| On violation | allocation > capacity → ceremony abort with `allocation_exceeds_per_client_cap` |

**Default per-client channel capacity.** When `allocations[]` (factory state, NOT policy) is empty at factory creation, every initial client receives `per_client_capacity_sat` as their A&L channel capacity. When `allocations[]` is present, the array overrides per-client values for the named pubkeys — but each entry must satisfy `min_capacity_per_join_sat ≤ allocation ≤ max_capacity_per_join_sat`. For late joiners (admission after factory creation), the joiner can request any value in `[min, max]`; their actual capacity is drawn from L-stock subject to L-stock availability.

**Boundary with state:** `allocations[]` is factory state (returned by `factory-list-public` alongside the policy, not part of the policy diff). The policy field constrains the state.

#### 4.4.2 `lsp_reserve_per_leaf_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0301 |
| Type | u64 |
| Default | 50000 |
| Range | 0 – `per_client_capacity_sat` |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | allocation builder |
| Enforced by | lib |
| On violation | construction fails if reserve totals > funding |

Per-leaf L-stock output value. Lets the LSP sell inbound liquidity later without clients being online.

#### 4.4.3 `lsp_initial_balance_pct`

| Attribute | Value |
|---|---|
| TLV ID | 0x0302 |
| Type | u8 (percent) |
| Default | 100 (LSP retains all initial balance until clients buy it) |
| Range | 0 – 100 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | allocation builder |
| Enforced by | lib |
| On violation | invalid balance distribution → construction fails |

The percentage of funding the LSP retains for itself at factory creation. `100` means clients start with zero balance (must buy from L-stock); `0` means LSP retains nothing (clients fully funded at creation). **This field caused the TS1 v1 bug** where `--demo` overrode it to 50 silently; making it explicit prevents recurrence.

#### 4.4.4 `min_capacity_per_join_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0306 |
| Type | u64 |
| Default | 10000 |
| Range | 546 – `max_capacity_per_join_sat` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | joiner admission |
| Enforced by | plugin |
| On violation | reject with `capacity_below_minimum` |

Floor on what a joiner can request. Prevents dust spam.

#### 4.4.5 `max_capacity_per_join_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0307 |
| Type | u64 |
| Default | `per_client_capacity_sat` |
| Range | `min_capacity_per_join_sat` – funding total |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | joiner admission |
| Enforced by | plugin |
| On violation | reject with `capacity_above_maximum` |

Ceiling on what a joiner can request. Anti-griefing cap.

---

### 4.5 Channel options (5 fields)

All previously stored only in browser `localStorage`; this spec makes them part of the policy contract.

#### 4.5.1 `allow_bolt12`

| Attribute | Value |
|---|---|
| TLV ID | 0x0400 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin invoice generation / consumption |
| Enforced by | plugin |
| On violation | BOLT-12 offer fetch on this channel returns error |

Whether channels in this factory honor BOLT-12 offers.

#### 4.5.2 `allow_amp`

| Attribute | Value |
|---|---|
| TLV ID | 0x0401 |
| Type | bool |
| Default | false |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin HTLC accept hook |
| Enforced by | plugin |
| On violation | AMP HTLC on this channel rejected |

Atomic multi-part payments support.

#### 4.5.3 `htlc_min_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0402 |
| Type | u64 |
| Default | 1 |
| Range | 1 – `htlc_max_sat` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin HTLC accept hook |
| Enforced by | plugin |
| On violation | HTLC rejected with `htlc_too_small` |

#### 4.5.4 `htlc_max_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0403 |
| Type | u64 |
| Default | 0 (= channel capacity) |
| Range | 0 – channel capacity |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin HTLC accept hook |
| Enforced by | plugin |
| On violation | HTLC rejected with `htlc_too_large` |

`0` is a sentinel meaning "use the channel's capacity as the cap."

#### 4.5.5 `allow_blinded_paths`

| Attribute | Value |
|---|---|
| TLV ID | 0x0404 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin invoice generation, BOLT-4 onion routing |
| Enforced by | plugin |
| On violation | blinded route request through this channel fails |

Privacy feature. When enabled, factory channels can appear as blinded paths in invoices.

---

### 4.6 HTLC policy (5 fields)

#### 4.6.1 `max_concurrent_htlcs_per_channel`

| Attribute | Value |
|---|---|
| TLV ID | 0x0500 |
| Type | u16 |
| Default | 30 |
| Range | 1 – 483 (BOLT-2 maximum) |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | channeld `update_add_htlc` accept logic |
| Enforced by | CLN core (existing BOLT-2 enforcement) |
| On violation | reject with `too_many_htlcs` |

#### 4.6.2 `max_in_flight_msat_per_channel`

| Attribute | Value |
|---|---|
| TLV ID | 0x0501 |
| Type | u64 |
| Default | 0 (= 90% of channel capacity, derived) |
| Range | 0 – channel capacity in msat |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | channeld |
| Enforced by | CLN core |
| On violation | reject with `htlc_in_flight_exceeded` |

#### 4.6.3 `min_final_cltv_expiry_delta`

| Attribute | Value |
|---|---|
| TLV ID | 0x0502 |
| Type | u32 |
| Default | `block_early_count + 18` (BOLT-11 default 18 + factory headroom) |
| Range | `block_early_count` – 4032 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | invoice generation, plugin `htlc_accepted` hook |
| Enforced by | plugin (in v1 fork; CLN-native eventually) |
| On violation | reject HTLC, OR fail invoice generation |

Different from `block_early_count`: this is the CLTV delta added to invoices generated on this factory's channels. The CLN fork audit identified this as a missing piece — it should be auto-derived from `block_early_count` plus protocol defaults.

#### 4.6.4 `cltv_expiry_delta_forward`

| Attribute | Value |
|---|---|
| TLV ID | 0x0503 |
| Type | u32 |
| Default | `block_early_count + 40` |
| Range | `block_early_count` – 4032 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | gossipd `channel_update`, plugin pay logic |
| Enforced by | plugin (in v1 fork) |
| On violation | route through this channel uses unfavorable CLTV; payments may fail |

For routing payments **through** this factory's channels. Also identified by the CLN fork audit as missing.

**The `40` is provisional and inherited from CLN's default per-hop `cltv_expiry_delta` for ordinary (non-factory) routing — not a SuperScalar-specific optimization.** The optimal value balances (a) HTLC routing reliability (longer deltas survive more reorgs and propagation delays), (b) capital efficiency (shorter deltas free funds faster), and (c) the factory's own DW unwind window. The trustless-safety analysis of CLTV deltas for factory channels is open research; operators running SuperScalar on mainnet should evaluate this value against their specific deployment's reorg-depth tolerance and routing latency profile. v1.x may revise this default as operational experience accumulates. Also note: when running with significantly shortened `block_early_count` for testing (e.g., regtest with 6-block CLTV), the absolute `+40` constant becomes a large fraction of the total — operators on test networks may want to override to a proportionally smaller value.

#### 4.6.5 `max_accepted_htlcs`

| Attribute | Value |
|---|---|
| TLV ID | 0x0504 |
| Type | u16 |
| Default | 483 |
| Range | 1 – 483 |
| Mutability | immutable |
| Joiner-relevant | advertised |
| Enforced at | channeld |
| Enforced by | CLN core |
| On violation | BOLT-2 standard rejection |

Echoes the BOLT-2 `max_accepted_htlcs` channel parameter. Locked at creation.

---

### 4.7 Joiner admission (6 fields)

#### 4.7.1 `auto_accept_joiners`

| Attribute | Value |
|---|---|
| TLV ID | 0x0600 |
| Type | bool |
| Default | false |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin `factory-join-request` handler |
| Enforced by | plugin |
| On violation | (no violation — controls plugin behavior) |

When `true`, qualifying join requests are admitted without manual operator approval. When `false`, requests queue in a "pending joiners" UI for the operator to review.

#### 4.7.2 `banlist`

| Attribute | Value |
|---|---|
| TLV ID | 0x0601 |
| Type | array of byte[33] |
| Default | empty |
| Range | up to 256 pubkeys (8 KB cap) |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin join handler |
| Enforced by | plugin |
| On violation | reject join with `joiner_banned` |

Pubkeys here are rejected even when `auto_accept_joiners == true`. Stored as a TLV containing a sequence of 33-byte compressed pubkeys.

#### 4.7.3 `allowlist`

| Attribute | Value |
|---|---|
| TLV ID | 0x0602 |
| Type | array of byte[33] |
| Default | empty (= "open list", no allowlist enforced) |
| Range | up to 256 pubkeys |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin join handler |
| Enforced by | plugin |
| On violation | reject join with `joiner_not_in_allowlist` |

When non-empty, ONLY these pubkeys can join (even if `auto_accept_joiners == true`). Use for invite-only factories. New v1 field (not in PR #11 dialog yet — should be added).

(Note — `proof_tier_required` was removed in v1 draft 4. The proof tier is a property of the LSP's coordinator vouch — it's intrinsic to the LSP's Nostr identity, not configurable per-factory. Wallet-side filtering by tier is a wallet preference setting (see `RendezvousSettings.showPeerTier` and `tierCaps`), not factory policy.)

#### 4.7.4 `auto_finalize_on_dying`

| Attribute | Value |
|---|---|
| TLV ID | 0x0604 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin `block_added` hook |
| Enforced by | plugin |
| On violation | (no violation — controls plugin behavior) |

When `true`, plugin runs one last rotation + signs the distribution TX on entry to dying period. Costs one nSequence slot but ensures clean wind-down.

#### 4.7.5 `allow_tier_b_rollover`

| Attribute | Value |
|---|---|
| TLV ID | 0x0605 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin rotation handler |
| Enforced by | plugin + lib (`test_tier_b_rollover_ps` gate from CL2-TB) |
| On violation | reject Tier B rotation request, force full rotation instead |

PR-D Tier B allowed allocation changes mid-factory without full re-signing. Some operators may prefer full re-signing for security; this flag controls preference.

#### 4.7.6 `joiner_admission_window_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0606 |
| Type | u32 |
| Default | `lifetime_blocks - dying_period_blocks - 144` (= ~stop accepting joins 1 day before dying period) |
| Range | 0 – `lifetime_blocks` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin join handler, block-tick |
| Enforced by | plugin |
| On violation | reject with `joiner_admission_closed` |

Block height window (relative to factory creation) during which new joins are accepted. After this, only existing clients can interact.

---

### 4.8 Watchtower policy (6 fields)

#### 4.8.1 `watchtower_mode`

| Attribute | Value |
|---|---|
| TLV ID | 0x0700 |
| Type | enum u8 |
| Default | `WT_BOTH = 2` |
| Range | `WT_IN_PROCESS = 0`, `WT_STANDALONE = 1`, `WT_BOTH = 2` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised (joiners want to know what's defending their channels) |
| Enforced at | plugin startup, breach detection |
| Enforced by | plugin |
| On violation | (no violation — describes WT topology) |

Whether breach defense is in-plugin only, via a separate `superscalar_watchtower` process only, or both (recommended default after PR #159's standalone WT became reliable).

#### 4.8.2 `poison_tx_strategy`

| Attribute | Value |
|---|---|
| TLV ID | 0x0701 |
| Type | enum u8 |
| Default | `POISON_ORACULAR = 1` (post-#208 A3.1 refactor) |
| Range | `POISON_LAZY = 0`, `POISON_ORACULAR = 1` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | revocation step, breach response |
| Enforced by | lib + watchtower |
| On violation | (no violation — describes WT behavior) |

`ORACULAR`: penalty TX pre-built and persisted at revocation time. `LAZY`: built at breach detection time. Oracular trades a bit of disk for guaranteed sub-block breach response.

#### 4.8.3 `breach_response_fee_rate_sat_per_kvb`

| Attribute | Value |
|---|---|
| TLV ID | 0x0702 |
| Type | u64 |
| Default | 1000 (`SS_DEFAULT_FEE_RATE_SAT_PER_KVB`) |
| Range | 250 – 10000000 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | WT broadcast |
| Enforced by | watchtower |
| On violation | (no violation — describes WT behavior) |

Fee rate the WT uses when broadcasting penalty TXs. PR #163 added clamping to wallet/node minimum; this field is the upper-bound target, clamped down if unrealistic.

#### 4.8.4 `wt_startup_scan_depth_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0703 |
| Type | u16 |
| Default | 144 |
| Range | 6 – 10080 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | WT startup |
| Enforced by | watchtower |
| On violation | (no violation) |

How far back the standalone WT scans on startup for missed breaches. PR #159's Gap 4 fix ("late-arriving WT defended after 10-block delay") needs this configurable.

#### 4.8.5 `reorg_alarm_depth_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0704 |
| Type | u8 |
| Default | 2 |
| Range | 1 – 100 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | CL6 reorg detection in LSP + WT poll loops |
| Enforced by | watchtower + plugin |
| On violation | (no violation) |

Reorg depth at which the system surfaces alerts to the operator. Smaller = more sensitive.

#### 4.8.6 `reorg_response_strategy`

| Attribute | Value |
|---|---|
| TLV ID | 0x0705 |
| Type | enum u8 |
| Default | `REORG_REBROADCAST = 0` |
| Range | `REORG_REBROADCAST = 0`, `REORG_WAIT = 1`, `REORG_ALERT_ONLY = 2` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | CL6 reorg handler |
| Enforced by | plugin |
| On violation | (no violation) |

What to do when a reorg of depth ≥ `reorg_alarm_depth_blocks` is detected.

**Strategy semantics:**

- **`REORG_REBROADCAST = 0` (default)**: on detection of reorg ≥ `reorg_alarm_depth_blocks`, re-broadcast all in-flight TXes into the new chain view. Resume normal operations once chain stabilizes. Best for operators who want hands-off automatic recovery.

- **`REORG_WAIT = 1`**: pause NEW outgoing broadcasts for at least `reorg_alarm_depth_blocks × 2` blocks. In-flight TXes remain in mempool unaffected; do NOT re-broadcast them automatically (unlike REBROADCAST). At each new block, check whether chain has stabilized — definition: no reorg of depth ≥ `reorg_alarm_depth_blocks` has occurred in the previous `reorg_alarm_depth_blocks` blocks. If stabilized, resume normal broadcasts. If reorg deepens, continue waiting and escalate alert level. Best for operators who prefer to handle reorg recovery manually rather than have the plugin re-broadcast aggressively.

- **`REORG_ALERT_ONLY = 2`**: no behavioral change to broadcasts; emit operator alert and let the operator choose response. Best for highly customized deployments.

**Scope clarification — applies to ORDINARY broadcasts only.** This strategy controls rotation TXes, cooperative close TXes, and factory creation broadcasts. It does **NOT** apply to penalty/breach-response TXes — those are always re-broadcast aggressively with fee bumps by the watchtower module, regardless of `reorg_response_strategy`. This is intentional: breach response is loss-sensitive and not safely configurable to anything less than maximum urgency.

**Prior art and design provisionality.** These strategies are v1 starting points informed by Lightning Network's existing handling of analogous concerns:
- 0-conf channel funding (BOLT-2): factory channels reuse the established 0-conf treatment, accepting that funding-tx reorgs are absorbed without protocol-level escalation
- Standard force-close TX broadcasts (BOLT-3): commitment and HTLC transaction handling in CLN's onchaind already includes reorg detection and rebroadcast logic; SuperScalar's `REORG_REBROADCAST` mirrors that pattern
- CL6 same-height-reorg detection (still maturing): the underlying detection layer is in active development; v1 strategies will refine as detection coverage improves

Reorg resistance for offchain factory operations is an evolving design area. v1.x revisions may introduce more sophisticated strategies (fee-bumped rebroadcast on reorg, hybrid timed-wait-then-rebroadcast, depth-adaptive responses) as testnet4 + mainnet experience accumulates. Operators should expect the available strategy set and their semantics to evolve with each minor version.

---

### 4.9 PS chain policy (2 fields)

Only meaningful when `arity_mode == ARITY_PS`. v1 deployments using DW (ARITY_1, ARITY_2) can omit these from the wire diff entirely.

**Why chaining instead of replacement** (pre-APO security context). The PS leaf design uses chained transactions (chain[N+1] spends chain[N]'s output) rather than replacement-style state updates (the way Poon-Dryja revokes old commitments). This is required for multi-party MuSig2 safety pre-APO: a naïve replacement scheme leaks partial signatures across states in ways that compromise N-party sub-factories. Chaining ensures state K+1 is causally dependent on state K — publishing K cannot occur without K+1's signatures being constructable, and the pre-signed poison TX redistributes L-stock to clients if the LSP attempts to broadcast an old state. The trade-off is O(N) chain length in force-close blockspace and persistence. When BIP-118 `SIGHASH_ANYPREVOUT` activates and eltoo-style supersession becomes available, the leaf design migrates to O(1) state count (see `superscalar-docs/extensions/apo-integration.md`); the entire PS chain policy section becomes deprecated at that point.

**Operational bound (v1).** Chain length is bounded only by:
1. Bitcoin's 546-sat dust limit (physical floor — L-stock output can't shrink below dust on next advance)
2. LSP's operational discretion (storage, force-close blockspace, anti-DoS rate limiting at RPC level — none of these are policy concerns; they're owned by the operator)

No static count cap exists in v1 — earlier drafts proposed `max_advance_count_per_leaf` (default 50) but it was removed in draft 4 because (a) the dust limit is the natural physical bound, (b) operational concerns are operator-private (storage / force-close cost), and (c) a static cap is arbitrary relative to actual L-stock depletion economics.

#### 4.9.1 `advance_dust_warning_threshold_sat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0801 |
| Type | u64 |
| Default | 1000 |
| Range | 546 – 100000 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin `factory-ps-advance` |
| Enforced by | plugin |
| On violation | next advance returns warning with `ps_advance_dust_imminent`; UI surfaces "migrate soon" prompt |

When the L-stock output would drop below this on the NEXT advance, surface warning. The hard physical floor is the 546-sat Bitcoin dust limit; this threshold provides a configurable warning above that floor so operators have time to plan migration or open a JIT fallback channel.

#### 4.9.2 `state_replay_defense_window_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0802 |
| Type | u32 |
| Default | `lifetime_blocks` (the full factory lifetime) |
| Range | `block_early_count` – `lifetime_blocks * 2` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | revocation secret retention, WT entry expiry |
| Enforced by | lib + watchtower |
| On violation | (no violation — sets retention window) |

How long after a state advance the system retains penalty data for that state, in case the LSP later attempts to broadcast it. CL3 multi-state replay defense depends on this.

---

### 4.10 Fee policy (2 fields)

#### 4.10.1 `fee_rate_strategy`

| Attribute | Value |
|---|---|
| TLV ID | 0x0900 |
| Type | enum u8 |
| Default | `FEE_BLOCKS = 2` (lib default per `superscalar_sdk.h`) |
| Range | `FEE_STATIC = 0`, `FEE_RPC = 1`, `FEE_BLOCKS = 2`, `FEE_API = 3` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | fee estimator selection at startup |
| Enforced by | lib |
| On violation | (no violation — selects estimator backend) |

Which fee estimator backend the factory uses when broadcasting its own TXs.

#### 4.10.2 `min_fee_rate_sat_per_kvb`

| Attribute | Value |
|---|---|
| TLV ID | 0x0901 |
| Type | u64 |
| Default | 1000 (clamped up to wallet/node minimum per PR #163) |
| Range | 250 – 10000000 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | TX construction, broadcast |
| Enforced by | lib + plugin |
| On violation | clamp UP to wallet/node minimum (warn but don't error) |

PR #163 follow-up: floor on broadcast fee rate. Lower values silently clamped to the wallet/node minimum.

---

### 4.11 Migration policy (3 fields)

#### 4.11.1 `migration_paths_supported`

| Attribute | Value |
|---|---|
| TLV ID | 0x0A00 |
| Type | bitmask u8 |
| Default | `MIG_LN_PAYMENT | MIG_PTLC_EXIT | MIG_ONCHAIN_SWAP` (= 0b111, all three) |
| Range | any combination of `MIG_LN_PAYMENT = 1`, `MIG_PTLC_EXIT = 2`, `MIG_ONCHAIN_SWAP = 4` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin `factory-migrate` handlers |
| Enforced by | plugin |
| On violation | reject migration request with `migration_path_not_supported` |

Which client-migration paths this LSP supports when the factory enters dying period. From `how-it-works/client-migration.md`.

#### 4.11.2 `allow_splice`

| Attribute | Value |
|---|---|
| TLV ID | 0x0A01 |
| Type | bool |
| Default | false |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | splice request handler in plugin |
| Enforced by | plugin |
| On violation | reject splice with `splice_not_allowed` |

Whether clients can splice their factory channels. From `extensions/splicing-integration.md`. Currently false until splice protocol matures inside factories.

#### 4.11.3 `allow_jit_fallback`

| Attribute | Value |
|---|---|
| TLV ID | 0x0A02 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin liquidity-purchase path |
| Enforced by | plugin |
| On violation | reject JIT fallback with `jit_fallback_disabled` |

When the factory can't allocate liquidity offchain (e.g., DW exhausted), LSP opens a standard on-chain channel. From `extensions/jit-channel-fallbacks.md`.

---

### 4.12 Routing / forwarding policy (4 fields)

#### 4.12.1 `forward_fee_policy`

| Attribute | Value |
|---|---|
| TLV ID | 0x0B00 |
| Type | enum u8 |
| Default | `FWD_NO_FORWARD = 0` |
| Range | `FWD_NO_FORWARD = 0`, `FWD_FLAT_PLUS_PPM = 1` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin HTLC forward hook |
| Enforced by | plugin |
| On violation | reject forward HTLC |

Whether the LSP forwards payments through joiners' channels. `NO_FORWARD` means channels in this factory are terminal-only (client-LSP only); `FLAT_PLUS_PPM` enables forwarding with fee structure from the next two fields.

#### 4.12.2 `forward_fee_base_msat`

| Attribute | Value |
|---|---|
| TLV ID | 0x0B01 |
| Type | u64 |
| Default | 1000 (1 sat) |
| Range | 0 – 1000000000 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised (only meaningful when `forward_fee_policy == FWD_FLAT_PLUS_PPM`) |
| Enforced at | gossip `channel_update`, plugin forwarding |
| Enforced by | plugin + gossipd |
| On violation | HTLC with insufficient fee → reject |

Base forwarding fee in millisatoshis.

#### 4.12.3 `forward_fee_ppm`

| Attribute | Value |
|---|---|
| TLV ID | 0x0B02 |
| Type | u32 |
| Default | 1 |
| Range | 0 – 100000 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | as above |
| Enforced by | plugin + gossipd |
| On violation | as above |

Parts-per-million of forwarded HTLC value.

#### 4.12.4 `lsp_self_routing_allowed`

| Attribute | Value |
|---|---|
| TLV ID | 0x0B03 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforced at | plugin `pay` integration |
| Enforced by | plugin |
| On violation | LSP-initiated payment via joiner channel rejected by client side |

Whether the LSP itself can use joiner channels as routes for the LSP's own outgoing payments. Some joiners may want their channels exclusively used for their own traffic.

---

### 4.13 Lifecycle commitments (5 fields)

These are operator-behavior commitments about how the LSP intends to run the factory over time. They materially affect joiner uptime requirements and continuity expectations. Earlier draft (v1 draft 1) excluded these as "LSP-only operational" — corrected here based on reviewer challenge: joiners need to know the operator's rotation cadence and continuity intent BEFORE joining, because it determines their required reachability schedule.

#### 4.13.1 `auto_host_next`

| Attribute | Value |
|---|---|
| TLV ID | 0x0C00 |
| Type | bool |
| Default | true |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforcement strength | **soft** (operator-behavior commitment) |
| Enforced at | plugin's automatic ladder scheduler |
| Enforced by | plugin |
| On violation | (no protocol violation — operator can choose to not honor this) |

When `true`, the plugin automatically hosts the next factory in the ladder at the configured cadence (see `ladder_cadence_blocks`) so a fresh slot is always available for clients to migrate into. When `false`, the operator hosts manually. Joiners who want continuity assurance should prefer LSPs advertising `auto_host_next == true`.

#### 4.13.2 `ladder_cadence_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0C01 |
| Type | u32 |
| Default | 4320 (≈ 30 days, one factory per active period) |
| Range | 144 – 525960 |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforcement strength | **soft** |
| Enforced at | plugin's ladder scheduler |
| Enforced by | plugin |
| On violation | (no protocol violation) |

Renamed from earlier draft's `ladder_cadence_hours`; using blocks for chain-time consistency with all other timing fields. How often the LSP plans to spin up the next factory in their ladder. Smaller values mean fresher migration targets (joiners face less risk that the next factory won't be ready when they need to migrate); larger values mean less LSP overhead. **The dying period of the OLD factory must cleanly overlap with the active period of the NEW factory** — `ladder_cadence_blocks` SHOULD be ≤ `lifetime_blocks - dying_period_blocks` to ensure overlap. Wallets render a warning if this invariant is violated.

#### 4.13.3 `auto_rotate_periodically`

| Attribute | Value |
|---|---|
| TLV ID | 0x0C02 |
| Type | bool |
| Default | false |
| Mutability | mutable_with_consent (changing this changes joiner uptime requirements; treat as a policy renegotiation) |
| Joiner-relevant | advertised |
| Enforcement strength | **soft** (the BEHAVIOR is soft; the INTERVAL is joiner-enforceable hard — see `rotation_interval_blocks`) |
| Enforced at | plugin's rotation scheduler |
| Enforced by | plugin |
| On violation | (no direct protocol violation — but joiner client refuses rotations that violate `rotation_interval_blocks`, which is the hard backstop) |

Niche feature. When `true`, the plugin schedules periodic DW rotations (burns nSequence slots) even without any allocation change driving the need. Most operators leave OFF. When ON, each rotation requires the affected clients to sign — directly increases their required reachability cadence.

#### 4.13.4 `rotation_interval_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0C03 |
| Type | u32 |
| Default | 0 (= rotations on-demand only, no periodic schedule) |
| Range | 0 OR ≥ 144 (≥ ~1 day if periodic) |
| Mutability | mutable_with_consent |
| Joiner-relevant | advertised |
| Enforcement strength | **joiner_enforceable_hard** (client refuses to sign a rotation proposal that arrives sooner than this interval since the previous rotation) |
| Enforced at | plugin rotation handler (LSP-side); client's `ss_policy_validate_advance()` (joiner-side) |
| Enforced by | lib (joiner-side refusal) + plugin (LSP-side scheduling) |
| On violation | client refuses to sign a too-frequent rotation proposal; LSP's ceremony aborts; LSP must wait until interval elapses |

The minimum chain-blocks between rotations. When `auto_rotate_periodically == true`, the LSP rotates AT this cadence. When `auto_rotate_periodically == false` AND this field is > 0, the LSP can still rotate on-demand but no more often than this interval. **Joiners' clients enforce this hard**: even if the LSP-side plugin proposes a too-frequent rotation, the client validates and refuses to sign, aborting the ceremony. This bounds the worst-case signing burden joiners can be forced into.

#### 4.13.5 `expected_rotation_blocks`

| Attribute | Value |
|---|---|
| TLV ID | 0x0C04 |
| Type | u32 |
| Default | 0 (= no scheduled rotation expectation) |
| Range | 0 OR ≥ `rotation_interval_blocks` |
| Mutability | mutable_lsp_only |
| Joiner-relevant | advertised |
| Enforcement strength | **soft** (informational only — for joiner UX) |
| Enforced at | (not enforced — informational) |
| Enforced by | (n/a) |
| On violation | (n/a) |

The LSP's *intended* typical rotation cadence. Distinct from `rotation_interval_blocks`, which is the hard MINIMUM. Joiners use this to estimate "I'll likely need to come online for signing every ~X blocks." When `auto_rotate_periodically == false` and rotations are operator-on-demand, this can be 0 (no schedule) or a hint like "we rotate roughly weekly when we sell new liquidity."

---

### 4.14 Cross-field invariants

These invariants are enforced at validation time (`ss_policy_validate_struct`). Any policy that violates an invariant is **rejected** before persistence or advertising. The diff-from-default wire format does NOT carry invalid combinations because they're refused at config time.

#### 4.14.1 Tree-shape coherence

| Invariant | Rule |
|---|---|
| **A** | `arity_mode = AUTO` is config-input-only. Plugin resolves to one of `ARITY_1` / `ARITY_2` / `ARITY_PS` at factory-create and persists the resolved value. `AUTO` never appears on the wire. |
| **B** | When `arity_mode == ARITY_PS`: `leaf_arity` MUST be set to 1. (Each PS leaf hosts 1 client + LSP; non-1 values are nonsensical for PS topology and validator rejects.) |
| **C** | When `arity_mode == ARITY_PS`: `leaf_channel_type` MUST be `PSEUDO_SPILMAN`. Combination with `LN_PENALTY` is invalid. |
| **D** | When `arity_mode != ARITY_PS`: `ps_subfactory_arity` MUST be 0 (ignored). Validator may accept any value but plugin should normalize to 0 before wire encoding. |
| **E** | `epoch_count` MUST be expressible as `states_per_layer^n_layers` for integer `states_per_layer ≥ 2`. E.g., (epoch_count=16, n_layers=2) → states_per_layer=4 ✓. (epoch_count=8, n_layers=2) → states_per_layer ≈ 2.83 ✗ rejected. |

#### 4.14.2 Lifecycle and capacity bounds

| Invariant | Rule |
|---|---|
| **F1** | `dying_period_blocks < lifetime_blocks` (dying must fit inside active period) |
| **F2** | `block_early_count < lifetime_blocks - dying_period_blocks` (early-warning must be inside non-dying portion to be useful) |
| **F3** | `joiner_admission_window_blocks ≤ lifetime_blocks - dying_period_blocks` (can't admit during dying period) |
| **F4** | `min_capacity_per_join_sat ≤ per_client_capacity_sat ≤ max_capacity_per_join_sat` (default capacity must satisfy joiner bounds) |
| **F5** | Sum of all allocations + `lsp_reserve_per_leaf_sat × n_leaves` ≤ `funding_sats` (allocation math must close at factory creation) |

#### 4.14.3 Joiner admission coherence

| Invariant | Rule |
|---|---|
| **I** | A pubkey MUST NOT appear in BOTH `banlist` AND `allowlist`. Operator error if it does; validator rejects the policy struct. |
| **M** | `migration_paths_supported != 0` (at least one migration path must be enabled; a factory with no migration paths cannot wind down gracefully and is rejected). |

#### 4.14.4 Lifecycle commitment coherence

| Invariant | Rule |
|---|---|
| **N1** | If `auto_rotate_periodically == true`: `rotation_interval_blocks >= 144` (~1 day minimum; smaller would burn nSequence slots too fast and stress joiner uptime). |
| **N2** | `rotation_interval_blocks ≤ lifetime_blocks - dying_period_blocks` (rotation can't be scheduled to fire after the active period ends). |
| **N3** | If `expected_rotation_blocks != 0`: `expected_rotation_blocks >= rotation_interval_blocks` (expected cadence cannot violate the hard minimum). |
| **N4** | `ladder_cadence_blocks ≤ lifetime_blocks - dying_period_blocks` (next factory in ladder should be available before this one's dying period ends; soft advisory — wallet renders warning if violated, not a hard reject). |

#### 4.14.5 Routing and forwarding coherence

| Invariant | Rule |
|---|---|
| **R1** | If `forward_fee_policy == NO_FORWARD`: `forward_fee_base_msat` and `forward_fee_ppm` are ignored. Validator accepts any value but plugin should normalize to defaults for clarity. |

#### 4.14.6 General principle

**Validators reject invalid configurations.** Any cross-field combination not listed above is allowed. Diff-from-default wire encoding ensures common-case policies (most fields at default) transmit only the deltas; receivers reconstruct the full policy by filling in defaults from §9 for every absent field. Invariants are checked AFTER reconstruction: receivers MUST run validation on the reconstructed full policy before treating it as authoritative.

---

## 5. Wire format

### 5.1 Outer envelope

The policy diff travels inside a bLIP-56 `factory_piggyback` payload, dispatched via a new app-level submsg pair:

```
SS_SUBMSG_FACTORY_INFO_REQUEST (proposed: 0x0140)
  - empty body (the request itself is just "tell me about this factory_instance_id")

SS_SUBMSG_FACTORY_INFO_RESPONSE (proposed: 0x0141)
  - schema_version (TLV 0x0000) — REQUIRED, always first
  - protocol_id    (TLV 0x0001) — REQUIRED, always second
  - instance_id    (TLV 0x0002, RUNTIME STATE not policy) — REQUIRED
  - lifecycle      (TLV 0x0003, RUNTIME STATE) — REQUIRED
  - epoch          (TLV 0x0004, RUNTIME STATE) — REQUIRED
  - open_slots     (TLV 0x0005, RUNTIME STATE) — REQUIRED
  - epochs_remaining (TLV 0x0006, RUNTIME STATE) — REQUIRED
  - <policy diff>  (any subset of policy TLVs 0x0100..0x0BFF) — OPTIONAL
                   (if a TLV is absent, the value defaults per this spec)
```

Note: state fields (0x0002–0x0006) share the namespace but are NOT policy. They're packed into the same response message for joiner UX convenience.

### 5.2 TLV encoding rules

- **u8 / u16 / u32 / u64**: BigInt-style big-endian, exactly N bytes.
- **bool**: 1 byte, 0 or 1.
- **bitmask u8**: 1 byte, OR-combined flags.
- **enum u8**: 1 byte, value space defined per-field.
- **byte[N]**: exactly N bytes, no length prefix (length determined by TLV length field).
- **array of byte[33]**: payload length must be a multiple of 33; concatenated 33-byte entries.

### 5.3 Diff semantics

A field absent from the response **MUST** be treated as the v1 default value documented in this spec. Senders **SHOULD** omit TLVs whose value equals the default to minimize payload.

Exception: `schema_version` and `protocol_id` are ALWAYS sent, even if at default, so receivers can validate compatibility before parsing the body.

### 5.4 Unknown TLV handling

Receivers parsing a `schema_version` they recognize **MUST** ignore unknown TLV IDs within the policy ranges. This preserves forward compatibility: v1.1 can add fields with new TLV IDs, and v1.0 clients silently ignore them.

Receivers parsing an unknown `schema_version` **MUST NOT** attempt to interpret the body. They should treat the factory as "policy unknown" and decline to join.

### 5.5 Maximum payload

With all fields at non-default values (worst case):
- Fixed-size fields total: ~250 bytes including TLV envelope overhead
- Banlist (256 × 33 + tag): ~8.5 KB
- Allowlist (256 × 33 + tag): ~8.5 KB
- **Worst-case total: ~17 KB**

Typical case with small banlist + most fields at default: **< 200 bytes**.

---

## 6. Plugin RPC response (JSON)

The plugin exposes a new RPC `factory-list-public` that returns the policy in JSON form for wallet rendering. Unlike the wire format, the JSON response **expands all fields to their effective values** (defaults filled in), to spare the wallet the work of merging.

### Request

```json
{
  "method": "factory-list-public",
  "params": {
    "instance_id": "<hex>"
  }
}
```

If `instance_id` is omitted, returns the public policy for every factory the LSP hosts.

### Response

```json
{
  "factories": [
    {
      "schema_version": 1,
      "protocol_id": "5375706572536361 6c61722f7631 ...",
      "instance_id": "<hex>",
      "lifecycle": "active",
      "epoch": 3,
      "epochs_remaining": 13,
      "open_slots": 2,
      "policy": {
        "tree_shape": {
          "arity_mode": "arity_ps",
          "leaf_arity": 2,
          "leaf_channel_type": "pseudo_spilman",
          "ps_subfactory_arity": 2,
          "epoch_count": 16,
          "n_layers": 2,
          "dw_step_blocks": 144,
          "static_near_root_layers": 0
        },
        "lifecycle": {
          "lifetime_blocks": 4320,
          "dying_period_blocks": 288,
          "block_early_count": 144,
          "confirm_timeout_sec": 86400
        },
        "economics": {
          "per_client_capacity_sat": 100000,
          "lsp_reserve_per_leaf_sat": 50000,
          "lsp_initial_balance_pct": 100,
          "min_capacity_per_join_sat": 10000,
          "max_capacity_per_join_sat": 100000
        },
        "channel_options": {
          "allow_bolt12": true,
          "allow_amp": false,
          "htlc_min_sat": 1,
          "htlc_max_sat": 0,
          "allow_blinded_paths": true
        },
        "htlc_policy": {
          "max_concurrent_htlcs_per_channel": 30,
          "max_in_flight_msat_per_channel": 0,
          "min_final_cltv_expiry_delta": 162,
          "cltv_expiry_delta_forward": 184,
          "max_accepted_htlcs": 483
        },
        "joiner_admission": {
          "auto_accept_joiners": false,
          "banlist": [],
          "allowlist": [],
          "auto_finalize_on_dying": true,
          "allow_tier_b_rollover": true,
          "joiner_admission_window_blocks": 3888
        },
        "watchtower": {
          "watchtower_mode": "both",
          "poison_tx_strategy": "oracular",
          "breach_response_fee_rate_sat_per_kvb": 1000,
          "wt_startup_scan_depth_blocks": 144,
          "reorg_alarm_depth_blocks": 2,
          "reorg_response_strategy": "rebroadcast"
        },
        "ps_chain": {
          "advance_dust_warning_threshold_sat": 1000,
          "state_replay_defense_window_blocks": 4320
        },
        "fee": {
          "fee_rate_strategy": "blocks",
          "min_fee_rate_sat_per_kvb": 1000
        },
        "migration": {
          "migration_paths_supported": ["ln_payment", "ptlc_exit", "onchain_swap"],
          "allow_splice": false,
          "allow_jit_fallback": true
        },
        "routing": {
          "forward_fee_policy": "no_forward",
          "forward_fee_base_msat": 1000,
          "forward_fee_ppm": 1,
          "lsp_self_routing_allowed": true
        }
      }
    }
  ]
}
```

Wallets render this 1:1 in the Connect tab row when a vouch is selected.

---

## 7. Validators

Each enforcement role checks the policy at specific points. This section lists every validation call site.

**Architectural note (v1 draft 3):** the `ss_factory_policy_t` struct, its validators, and its TLV codec live entirely in the **plugin's source tree** (`superscalar-cln/*.c`), **not in the lib**. The SuperScalar lib has no concept of "policy" — it exposes discrete parameters (via CLI flags + `ss_config_t` + factory-construction APIs) and behaves accordingly. The plugin owns the policy struct and populates lib parameters from it. See §10.5 for the CLI-flag mapping, and §12 for the implementation split.

### 7.1 Plugin validators (`superscalar-cln`)

The policy struct + validators live in plugin code, not the lib. The plugin validates at every signing point and on inbound peer messages.

```c
/* Plugin-side definitions; lives in superscalar-cln source tree, NOT in the lib. */

int ss_policy_validate_struct(const ss_factory_policy_t *p,
                               ss_validation_error_t *err);
/* Range-checks every field. Cross-field invariants (full list in §4.14):
 *   - allocation_sum + lsp_reserve_per_leaf_sat * n_leaves <= funding_sats
 *   - epoch_count must factor as states^n_layers
 *   - block_early_count < lifetime_blocks - dying_period_blocks
 *   - min_capacity <= per_client_capacity <= max_capacity
 *   - dying_period < lifetime
 *   - banlist + allowlist must not overlap
 *   - migration_paths_supported != 0
 *   - auto_rotate_periodically=true implies rotation_interval_blocks >= 144
 *   - if arity_mode == ARITY_PS: leaf_arity == 1, leaf_channel_type == PSEUDO_SPILMAN
 */

int ss_policy_validate_advance(const ss_factory_policy_t *p,
                                const ss_advance_proposal_t *proposal,
                                ss_validation_error_t *err);
/* Called by LSP before signing any state advance proposal,
 * AND by client before signing what the LSP proposes (joiner-enforceable hard).
 *   - new_allocation_for_joiner <= max_capacity_per_join_sat
 *   - joiner_pubkey not in banlist
 *   - if allowlist non-empty: joiner_pubkey in allowlist
 *   - if Tier B rotation: allow_tier_b_rollover == true
 *   - if PS advance: next_L_stock_value >= dust limit (546 sats)
 *   - blocks_since_last_rotation >= rotation_interval_blocks
 *     (joiner refuses too-frequent rotations)
 */

int ss_policy_validate_join_request(const ss_factory_policy_t *p,
                                     const ss_join_request_t *req,
                                     uint32_t current_block_height,
                                     ss_validation_error_t *err);
/* Called by LSP before admitting a joiner.
 *   - block_height < factory_creation_block + joiner_admission_window_blocks
 *   - capacity_requested in [min_capacity_per_join_sat, max_capacity_per_join_sat]
 *   - joiner_pubkey not in banlist
 *   - if allowlist non-empty: joiner_pubkey in allowlist
 */

int ss_policy_validate_htlc(const ss_factory_policy_t *p,
                             const ss_htlc_t *htlc,
                             ss_validation_error_t *err);
/* Called by LSP and client on every HTLC add.
 *   - htlc.amount_msat / 1000 in [htlc_min_sat, htlc_max_sat]
 *   - htlc.cltv_expiry >= current_height + block_early_count
 *   - in_flight_after_add <= max_in_flight_msat_per_channel
 *   - htlcs_after_add <= max_concurrent_htlcs_per_channel
 */

int ss_plugin_validate_factory_create(const ss_factory_policy_t *requested,
                                       ss_validation_error_t *err);
/* Called when the operator submits factory-create RPC. Wraps
 * ss_policy_validate_struct + plugin-specific checks (e.g., this CLN
 * node actually has enough on-chain funds). */

int ss_plugin_validate_inbound_join(const ss_factory_policy_t *p,
                                     const ss_join_request_t *req);
/* Called from custommsg dispatch when a peer sends FACTORY_JOIN_REQUEST. */

int ss_plugin_validate_outbound_proposal(const ss_factory_policy_t *p,
                                          const ss_advance_proposal_t *prop);
/* Client side: before signing what the LSP proposes for a state advance,
 * confirm the proposal honors the policy we agreed to. */
```

### 7.2 Lib parameter touch points (`SuperScalar/src/*`)

The lib never sees the policy struct. The plugin populates discrete lib parameters from policy values at call time. The relevant touch points:

```c
/* Lib API surface — already present today */
void ss_config_default(ss_config_t *cfg, const char *network);
int  ss_node_init(ss_node_t *node, const ss_config_t *cfg);
int  ss_node_run_cycle(ss_node_t *node);
void ss_node_free(ss_node_t *node);

/* Plugin invocation pattern (sketch):
 *   ss_config_t cfg;
 *   ss_config_default(&cfg, "testnet4");
 *   cfg.fee_mode = (policy->fee_rate_strategy == FEE_STATIC)  ? SS_FEE_STATIC
 *                : (policy->fee_rate_strategy == FEE_RPC)     ? SS_FEE_RPC
 *                : (policy->fee_rate_strategy == FEE_BLOCKS)  ? SS_FEE_BLOCKS
 *                :                                              SS_FEE_API;
 *   cfg.fee_static_sat_per_kvb = policy->min_fee_rate_sat_per_kvb;
 *   cfg.db_path = "<cln-datadir>/superscalar/factories/<iid>/lib.db";
 *   ss_node_init(&node, &cfg);
 *
 * Then for the factory-construction call (in factory.h, not yet a single API):
 *   ss_factory_create_args_t args = {
 *     .clients = clients,
 *     .n_clients = policy->n_clients,
 *     .arity_mode = policy->arity_mode,
 *     .leaf_arity = policy->leaf_arity,
 *     .leaf_channel_type = policy->leaf_channel_type,
 *     .ps_subfactory_arity = policy->ps_subfactory_arity,
 *     .epoch_count = policy->epoch_count,
 *     .n_layers = policy->n_layers,
 *     .dw_step_blocks = policy->dw_step_blocks,
 *     .static_near_root_layers = policy->static_near_root_layers,
 *     .lifetime_blocks = policy->lifetime_blocks,
 *     .dying_period_blocks = policy->dying_period_blocks,
 *     .block_early_count = policy->block_early_count,
 *     .confirm_timeout_sec = policy->confirm_timeout_sec,
 *     .per_client_capacity_sat = policy->per_client_capacity_sat,
 *     .lsp_reserve_per_leaf_sat = policy->lsp_reserve_per_leaf_sat,
 *     .lsp_initial_balance_pct = policy->lsp_initial_balance_pct,
 *     .allocations = policy_allocations,
 *   };
 *   factory_create(&args, &factory_out, &err);
 *
 * Watchtower init:
 *   ss_watchtower_config_t wt_cfg = {
 *     .mode = policy->watchtower_mode,
 *     .poison_strategy = policy->poison_tx_strategy,
 *     .breach_fee_rate_sat_per_kvb = policy->breach_response_fee_rate_sat_per_kvb,
 *     .startup_scan_depth_blocks = policy->wt_startup_scan_depth_blocks,
 *     .reorg_alarm_depth_blocks = policy->reorg_alarm_depth_blocks,
 *     .reorg_response_strategy = policy->reorg_response_strategy,
 *   };
 *   watchtower_init(&wt, &wt_cfg);
 */
```

**The lib's job:** accept parameters, do what it's told, expose well-named struct fields. No policy concept; no validators of policy invariants.

**The plugin's job:** keep the policy struct, validate, persist, advertise, populate lib config structs at each lib call.

### 7.3 Watchtower references (`SuperScalar/src/watchtower.c`)

The WT doesn't validate policy at attack time — by then it's too late. It REFERENCES policy-derived parameters when constructing penalty TXs. These parameters arrive via `ss_watchtower_config_t` at init (sketch above), NOT via a policy struct.

```c
/* Inside the WT's breach-response handler */
if (wt->config.poison_strategy == POISON_ORACULAR) {
    use_presigned_penalty(entry->signed_penalty_tx, entry->signed_penalty_tx_len);
} else {
    build_penalty_tx_lazily(...);
}

uint64_t fee_rate = MIN(wt->config.breach_fee_rate_sat_per_kvb,
                         wallet_minimum_fee_rate());
```

Plugin-side WT entry registration also references policy-derived tree shape (`n_layers`, `dw_step_blocks`) — these are passed at watch-entry-registration time, not pulled from a lib-side policy struct.

---

## 8. Versioning

### 8.1 v1 stability promise

These v1 fields will not have their **TLV IDs renumbered** in v1.x. Their **types and ranges** will not change incompatibly. Their **defaults** may shift across v1.x minor versions (with documented changelog entries).

### 8.2 Forward compatibility

v1.x clients reading v1.y (where y > x) policies:
- Unknown TLV IDs: silently ignored
- Known TLV IDs with new range values: treated as policy violations (rejection)

v1.x clients reading v2 policies:
- `schema_version` mismatch → reject the entire policy; treat factory as "unknown policy"

### 8.3 Adding fields in v1.x

A new field in v1.1 (e.g., a hypothetical `allow_zero_conf_routing` bool) gets:
- A new TLV ID in the appropriate range
- A v1.1 default value
- v1.0 clients ignore it (= treat as v1.0 default, which is "field doesn't exist")
- v1.1 clients honor it

This works as long as the new field's "missing" semantics are equivalent to its v1.0 absence. Fields whose presence FUNDAMENTALLY changes interpretation should wait for v2.

### 8.4 v2 trigger

v2 is required when:
- A field's interpretation changes incompatibly
- A field is removed (vs. renamed; renaming via deprecation is v1.x)
- The wire envelope structure changes
- Cross-field invariants change (e.g., changing how `min_final_cltv_expiry_delta` derives from `block_early_count`)

---

## 9. Defaults reference table

For quick lookup. All values are v1.0 defaults.

| Category | Field | Default |
|---|---|---|
| Schema | `schema_version` | 1 |
| Schema | `protocol_id` | `"SuperScalar/v1"` (32B zero-pad) |
| Tree shape | `arity_mode` | `ARITY_PS` |
| Tree shape | `leaf_arity` | 2 |
| Tree shape | `leaf_channel_type` | `PSEUDO_SPILMAN` |
| Tree shape | `ps_subfactory_arity` | 2 |
| Tree shape | `epoch_count` | 16 |
| Tree shape | `n_layers` | 2 |
| Tree shape | `dw_step_blocks` | 144 |
| Tree shape | `static_near_root_layers` | 0 |
| Lifecycle | `lifetime_blocks` | 4320 |
| Lifecycle | `dying_period_blocks` | 288 |
| Lifecycle | `block_early_count` | 144 |
| Lifecycle | `confirm_timeout_sec` | 86400 |
| Economics | `per_client_capacity_sat` | 100000 |
| Economics | `lsp_reserve_per_leaf_sat` | 50000 |
| Economics | `lsp_initial_balance_pct` | 100 |
| Economics | `min_capacity_per_join_sat` | 10000 |
| Economics | `max_capacity_per_join_sat` | `per_client_capacity_sat` |
| Channel | `allow_bolt12` | true |
| Channel | `allow_amp` | false |
| Channel | `htlc_min_sat` | 1 |
| Channel | `htlc_max_sat` | 0 (= capacity) |
| Channel | `allow_blinded_paths` | true |
| HTLC | `max_concurrent_htlcs_per_channel` | 30 |
| HTLC | `max_in_flight_msat_per_channel` | 0 (= 90% of capacity) |
| HTLC | `min_final_cltv_expiry_delta` | `block_early_count + 18` |
| HTLC | `cltv_expiry_delta_forward` | `block_early_count + 40` |
| HTLC | `max_accepted_htlcs` | 483 |
| Joiner | `auto_accept_joiners` | false |
| Joiner | `banlist` | empty |
| Joiner | `allowlist` | empty |
| Joiner | `auto_finalize_on_dying` | true |
| Joiner | `allow_tier_b_rollover` | true |
| Joiner | `joiner_admission_window_blocks` | `lifetime_blocks - dying_period_blocks - 144` |
| Watchtower | `watchtower_mode` | `BOTH` |
| Watchtower | `poison_tx_strategy` | `ORACULAR` |
| Watchtower | `breach_response_fee_rate_sat_per_kvb` | 1000 |
| Watchtower | `wt_startup_scan_depth_blocks` | 144 |
| Watchtower | `reorg_alarm_depth_blocks` | 2 |
| Watchtower | `reorg_response_strategy` | `REBROADCAST` |
| PS chain | `advance_dust_warning_threshold_sat` | 1000 |
| PS chain | `state_replay_defense_window_blocks` | `lifetime_blocks` |
| Fee | `fee_rate_strategy` | `FEE_BLOCKS` |
| Fee | `min_fee_rate_sat_per_kvb` | 1000 |
| Migration | `migration_paths_supported` | all three (`LN_PAYMENT | PTLC_EXIT | ONCHAIN_SWAP`) |
| Migration | `allow_splice` | false |
| Migration | `allow_jit_fallback` | true |
| Routing | `forward_fee_policy` | `NO_FORWARD` |
| Routing | `forward_fee_base_msat` | 1000 |
| Routing | `forward_fee_ppm` | 1 |
| Routing | `lsp_self_routing_allowed` | true |
| Lifecycle commitments | `auto_host_next` | true |
| Lifecycle commitments | `ladder_cadence_blocks` | 4320 |
| Lifecycle commitments | `auto_rotate_periodically` | false |
| Lifecycle commitments | `rotation_interval_blocks` | 0 (= on-demand only) |
| Lifecycle commitments | `expected_rotation_blocks` | 0 (= no schedule) |

---

## 10. Mapping to existing code

Where each field is sourced from, today:

| Field | Today's source | After v1 |
|---|---|---|
| `arity_mode` | `factory-create` RPC param | `factory-create` RPC param + persisted as policy |
| `leaf_arity` | PR #11 dialog, sent if non-default | persisted as policy, validated |
| `leaf_channel_type` | PR #11 dialog | persisted, validated |
| `epoch_count` | PR #11 dialog | persisted, validated |
| `lifetime_blocks` | PR #11 dialog | persisted, validated |
| `dying_period_blocks` | PR #11 dialog | persisted, validated |
| `block_early_count` | PR #11 dialog | persisted, validated (CLN-fork-native eventually) |
| `auto_accept_joiners` | PR #11 dialog → localStorage **(not enforced today)** | persisted as policy, **plugin enforces** |
| `banlist` | PR #11 dialog → localStorage **(not enforced)** | as above |
| `allow_bolt12`, `allow_amp`, `htlc_min_sat`, `htlc_max_sat` | PR #11 → localStorage **(not enforced)** | as above |
| `auto_finalize_on_dying` | PR #11 → localStorage | persisted, plugin enforces |
| `auto_host_next` | PR #11 → localStorage **(not enforced)** | persisted as policy, soft commitment (§4.13.1) |
| `ladder_cadence_blocks` (renamed from `ladder_cadence_hours`) | PR #11 → localStorage | persisted as policy, soft commitment (§4.13.2); units change from hours to blocks for chain-time consistency |
| `auto_rotate_periodically` | PR #11 → localStorage | persisted as policy, soft commitment (§4.13.3); paired with `rotation_interval_blocks` for joiner enforcement |
| `rotation_interval_blocks` | not modeled today | **new in v1**; joiner-enforceable hard floor on rotation frequency (§4.13.4) |
| `expected_rotation_blocks` | not modeled today | **new in v1**; soft hint for joiner UX (§4.13.5) |
| `dw_step_blocks` | hardcoded 144 in `src/dw_state.c` | exposed as policy, configurable |
| `n_layers` | derived | exposed as policy |
| `confirm_timeout_sec` | CLI flag `--confirm-timeout` | exposed as policy |
| `ps_subfactory_arity` | CLI flag `--ps-subfactory-arity` | exposed as policy |
| `static_near_root_layers` | CLI flag `--static-near-root` | exposed as policy |
| `lsp_initial_balance_pct` | CLI flag `--lsp-balance-pct` (caused TS1 v1 bug) | exposed as policy, validated |
| `watchtower_mode` | hardcoded behavior post-#159 | exposed as policy |
| `poison_tx_strategy` | post-#208 A3.1 refactor (oracular) | exposed as policy |
| `breach_response_fee_rate_sat_per_kvb` | `SS_DEFAULT_FEE_RATE_SAT_PER_KVB = 1000` | exposed as policy |
| `wt_startup_scan_depth_blocks` | post-Gap 4 fix | exposed as policy |
| `reorg_alarm_depth_blocks`, `reorg_response_strategy` | post-CL6 | exposed as policy |
| `advance_dust_warning_threshold_sat` | implicit dust-limit check today | exposed as policy |
| `state_replay_defense_window_blocks` | post-CL3 | exposed as policy |
| `fee_rate_strategy` | `superscalar_sdk.h` enum | exposed as policy |
| `min_fee_rate_sat_per_kvb` | post-#163 clamp | exposed as policy |
| `migration_paths_supported` | `how-it-works/client-migration.md` describes 3 paths | exposed as policy |
| `allow_splice`, `allow_jit_fallback` | from extension docs | exposed as policy |
| `allow_tier_b_rollover` | post PR-D | exposed as policy |
| `forward_fee_policy`, `forward_fee_base_msat`, `forward_fee_ppm`, `lsp_self_routing_allowed` | not modeled today | new in v1 |
| `min_capacity_per_join_sat`, `max_capacity_per_join_sat` | not modeled today | new in v1 |
| `min_final_cltv_expiry_delta`, `cltv_expiry_delta_forward` | not modeled today | new in v1 — closes CLN fork audit gaps |
| `allow_blinded_paths` | not modeled today | new in v1 |
| `allowlist` | not modeled today | new in v1 |
| `joiner_admission_window_blocks` | not modeled today | new in v1 |
| `max_concurrent_htlcs_per_channel`, `max_in_flight_msat_per_channel`, `max_accepted_htlcs` | inherited from CLN core BOLT-2 defaults | exposed as policy |

**Bottom line:** 32 of the 57 fields come from existing dialog levers, CLI flags, or recent code that wasn't yet exposed as a policy field. 25 are net-new — most of them filling gaps the audit surfaced (CLTV inflation, joiner admission rules, migration paths, routing fees, lifecycle commitments).

---

## 10.5 CLI and lib API parameter mapping

This section enumerates the SuperScalar binary CLI flags + `ss_config_t` / construction-API parameters that correspond to each policy field. The plugin populates these from its policy struct when calling lib APIs. Fields marked **needs adding** require new CLI flag(s) / API param(s) on the binary or the lib.

Sources audited: `tools/superscalar_lsp.c` (argparser line ~1320–1700), `tools/superscalar_client.c` (line ~2089–2236), `tools/superscalar_watchtower.c` (line ~56–88), `include/superscalar/superscalar_sdk.h`.

**Symbol legend:**
- ✅ existing flag covers it (1:1 or close)
- ⚠ partial — a related flag exists but doesn't fully cover; may need extension or new flag
- ❌ no existing flag; new flag required on the relevant binary
- 📦 derived — no own flag; computed from other fields/flags

### 10.5.1 Schema (2 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `schema_version` | — | 📦 derived | Always 1 in v1; not parameterized |
| `protocol_id` | — | 📦 derived | Always `"SuperScalar/v1"` for these binaries |

### 10.5.2 Tree shape (8 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `arity_mode` | LSP `--arity 1\|2\|3` | ✅ | `3` = ARITY_PS in current shorthand; AUTO is plugin-side default selection |
| `leaf_arity` | LSP `--arity` (same flag, dual purpose) | ⚠ | Today `--arity` encodes BOTH arity_mode and leaf_arity together. Suggest splitting: keep `--arity` for arity_mode, add `--leaf-arity` for the DW leaf count when arity_mode is ARITY_1 or ARITY_2 |
| `leaf_channel_type` | — | ❌ | Add LSP `--leaf-channel-type pseudo-spilman\|ln-penalty` |
| `ps_subfactory_arity` | LSP `--ps-subfactory-arity N` | ✅ | k² wide-leaf factor |
| `epoch_count` | LSP `--states-per-layer N` (paired with n_layers) | 📦 derived | epoch_count = states_per_layer^n_layers |
| `n_layers` | — | ❌ | Add LSP `--n-layers N` (currently implicit; defaults to 2) |
| `dw_step_blocks` | LSP `--step-blocks N` | ✅ | Default 144 (~1 day) |
| `static_near_root_layers` | LSP `--static-near-root N` | ✅ | |

### 10.5.3 Lifecycle (4 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `lifetime_blocks` | LSP `--active-blocks N` | ✅ | Default 4320 (~30d) |
| `dying_period_blocks` | LSP `--dying-blocks N` | ✅ | Default 288 (~2d) |
| `block_early_count` | LSP `--cltv-timeout N` | ⚠ | Existing `--cltv-timeout` may serve this purpose; verify semantics match. If not, add `--block-early-count N`. Plugin must surface this on TLV 65600 (`factory_early_warning_time`) regardless |
| `confirm_timeout_sec` | LSP `--confirm-timeout N` | ✅ | Default 86400 sec |

### 10.5.4 Economics (5 fields)

v1 is pure-routing (see §4.4). No setup-fee flags.

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `per_client_capacity_sat` | LSP `--amount N` ÷ `--clients M` | 📦 derived | Today: `--amount` is total funding; per-client = amount/clients. Suggest making this explicit with `--per-client-capacity N` and computing total funding from it + reserve from it |
| `lsp_reserve_per_leaf_sat` | — | ❌ | Add LSP `--lsp-reserve-per-leaf N` |
| `lsp_initial_balance_pct` | LSP `--lsp-balance-pct N` | ✅ | The TS1 v1 bug source; default 100 (LSP retains all) |
| `min_capacity_per_join_sat` | — | ❌ | Add LSP `--min-capacity-per-join N` |
| `max_capacity_per_join_sat` | — | ❌ | Add LSP `--max-capacity-per-join N` |

### 10.5.5 Channel options (5 fields)

All of these currently exist only in the wallet's `localStorage` (per PR #11). None reach the binary. All need new flags.

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `allow_bolt12` | — | ❌ | Add LSP `--allow-bolt12 \| --no-allow-bolt12` |
| `allow_amp` | — | ❌ | Add LSP `--allow-amp \| --no-allow-amp` |
| `htlc_min_sat` | — | ❌ | Add LSP `--htlc-min-sat N` |
| `htlc_max_sat` | — | ❌ | Add LSP `--htlc-max-sat N` (0 = capacity) |
| `allow_blinded_paths` | — | ❌ | Add LSP `--allow-blinded-paths \| --no-allow-blinded-paths` |

### 10.5.6 HTLC policy (5 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `max_concurrent_htlcs_per_channel` | — | ❌ | Add LSP `--max-htlcs N`; CLN core uses BOLT-2 default 483 today |
| `max_in_flight_msat_per_channel` | — | ❌ | Add LSP `--max-in-flight-msat N` (0 = derive from capacity) |
| `min_final_cltv_expiry_delta` | — | ❌ | Add LSP `--min-final-cltv-delta N` (defaults derived from block_early_count + 18) |
| `cltv_expiry_delta_forward` | — | ❌ | Add LSP `--cltv-expiry-delta-forward N` (defaults block_early_count + 40) |
| `max_accepted_htlcs` | — | ❌ | Add LSP `--max-accepted-htlcs N`; default 483 BOLT-2 |

### 10.5.7 Joiner admission (6 fields)

Proof tier is a property of the coordinator's vouch (see §4.7), not configurable per-factory; no flag.

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `auto_accept_joiners` | — | ❌ | Add LSP `--auto-accept-joiners`. Today only in wallet localStorage |
| `banlist` | — | ❌ | Add LSP `--banlist <file>` or `--ban-pubkey <hex>` repeatable. Today only in wallet localStorage |
| `allowlist` | — | ❌ | Add LSP `--allowlist <file>` or `--allow-pubkey <hex>` repeatable |
| `auto_finalize_on_dying` | — | ❌ | Add LSP `--auto-finalize-on-dying \| --no-auto-finalize-on-dying`. Today only in wallet localStorage |
| `allow_tier_b_rollover` | — | ❌ | Add LSP `--allow-tier-b-rollover \| --no-allow-tier-b-rollover` (`--test-tier-b-rollover` is test-only, distinct) |
| `joiner_admission_window_blocks` | — | ❌ | Add LSP `--joiner-admission-window N` |

### 10.5.8 Watchtower policy (6 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `watchtower_mode` | — | ❌ | Add LSP `--watchtower-mode in-process\|standalone\|both`. Today: implicit per binary (LSP runs in-process; standalone via separate `superscalar_watchtower` invocation). The mode controls plugin behavior |
| `poison_tx_strategy` | — | ❌ | Add LSP `--poison-tx-strategy oracular\|lazy`. Today: hardcoded behavior post-#208 A3.1 (oracular default) |
| `breach_response_fee_rate_sat_per_kvb` | WT `--max-bump-fee N` | ⚠ | Existing `--max-bump-fee` caps the fee bump; semantically close but not the same. Add `--breach-response-fee-rate N` for the target rate. Plugin clamps via `--max-bump-fee` budget cap |
| `wt_startup_scan_depth_blocks` | — | ❌ | Add WT `--startup-scan-depth N`. Today: hardcoded post-Gap 4 fix at 144 |
| `reorg_alarm_depth_blocks` | — | ❌ | Add WT `--reorg-alarm-depth N`. Today: implicit via CL6 detection logic |
| `reorg_response_strategy` | — | ❌ | Add WT `--reorg-response rebroadcast\|wait\|alert-only` |

### 10.5.9 PS chain policy (2 fields)

Chain length is dust-bounded, not statically capped (see §4.9). No max-count flag.

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `advance_dust_warning_threshold_sat` | — | ❌ | Add LSP `--advance-dust-warning-threshold N` |
| `state_replay_defense_window_blocks` | — | ❌ | Add LSP `--state-replay-defense-window N`. Today: implicit (state retention = factory lifetime) |

### 10.5.10 Fee policy (2 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `fee_rate_strategy` | LSP `--fee-estimator <name>` + `ss_config_t.fee_mode` | ✅ | SDK enum: `SS_FEE_STATIC` / `SS_FEE_RPC` / `SS_FEE_BLOCKS` / `SS_FEE_API`. Plugin maps policy enum to SDK enum |
| `min_fee_rate_sat_per_kvb` | LSP `--fee-rate N` + `ss_config_t.fee_static_sat_per_kvb` | ⚠ | Existing `--fee-rate` is the target rate, not minimum. With PR #163 clamp, the effective floor is wallet/node minimum. Plugin treats `min_fee_rate_sat_per_kvb` as: "use this as the target rate" |

### 10.5.11 Migration policy (3 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `migration_paths_supported` | LSP `--no-jit` (partial) | ⚠ | `--no-jit` disables JIT fallback; corresponds to one bit of the bitmask. Need full flag set: `--migration-paths ln-payment,ptlc-exit,onchain-swap` (comma-separated) |
| `allow_splice` | — | ❌ | Add LSP `--allow-splice` (`--test-splice` is test-only) |
| `allow_jit_fallback` | LSP `--no-jit` (inverse) | ✅ | `--no-jit` disables; absence enables. Cleaner: `--allow-jit-fallback \| --no-jit` (alias) |

### 10.5.12 Routing / forwarding policy (4 fields)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `forward_fee_policy` | — | ❌ | Add LSP `--forward-fee-policy no-forward\|flat-plus-ppm` |
| `forward_fee_base_msat` | — | ❌ | Add LSP `--forward-fee-base-msat N` |
| `forward_fee_ppm` | LSP `--routing-fee-ppm N` | ✅ | Existing flag is the forwarding ppm (despite name shared with LSP-fee discussion in §10.5.4 — they're different roles) |
| `lsp_self_routing_allowed` | — | ❌ | Add LSP `--lsp-self-routing \| --no-lsp-self-routing` |

### 10.5.13 Lifecycle commitments (5 fields, new in v1 draft 2)

| Policy field | Existing flag(s) | Status | Notes |
|---|---|---|---|
| `auto_host_next` | LSP `--async-rotation` (related but distinct) | ⚠ | `--async-rotation` is about ceremony scheduling, not next-factory hosting. Add `--auto-host-next \| --no-auto-host-next` |
| `ladder_cadence_blocks` | — | ❌ | Add LSP `--ladder-cadence-blocks N`. Today: implicit operator scheduling |
| `auto_rotate_periodically` | — | ❌ | Add LSP `--auto-rotate-periodically` |
| `rotation_interval_blocks` | — | ❌ | Add LSP `--rotation-interval-blocks N` |
| `expected_rotation_blocks` | — | ❌ | Add LSP `--expected-rotation-blocks N` (informational; not enforced) |

### 10.5.14 Summary

| Status | Count | Categories |
|---|---|---|
| ✅ existing 1:1 (or close) | **10 fields** | mostly tree shape + lifecycle basics |
| ⚠ partial / needs extension or rename | **7 fields** | `leaf_arity`, `block_early_count`, `per_client_capacity_sat`, `breach_response_fee_rate_sat_per_kvb`, `min_fee_rate_sat_per_kvb`, `migration_paths_supported`, `auto_host_next` |
| ❌ no existing flag; new flag required | **37 fields** | mostly channel options, HTLC policy, joiner admission, watchtower policy, routing, lifecycle commitments |
| 📦 derived from other flags (no own flag) | **3 fields** | `schema_version`, `protocol_id`, plus `epoch_count` (computed from `states_per_layer` × `n_layers`) |

**~80% of the v1 policy field set requires new CLI flags or extensions.** This isn't surprising — the lib was built for the LSP-operator-runs-everything pattern, with most policy choices either hardcoded or implicit. Promoting these to explicit configurable parameters is the lib's main implementation work for v1.

### 10.5.15 Lib-side checklist (the punchlist)

Concrete deliverable for the lib developer:

1. **Add ~37 new CLI flags** across the three binaries (LSP: ~29, watchtower: ~6, client: ~2). Each backed by a new field in the relevant config struct (`ss_config_t` extensions, new `ss_factory_create_args_t`, new `ss_watchtower_config_t`).
2. **Split `--arity` into `--arity` (mode) + `--leaf-arity` (DW leaf count)** where the new field disambiguates.
3. **Make hardcoded values configurable**: DW step (currently `--step-blocks` already works), n_layers, confirm_timeout (already `--confirm-timeout`), watchtower scan depth, reorg alarm depth, oracular vs lazy poison strategy.
4. **No setup-fee flags** — v1 is pure-routing (see §4.4). `--routing-fee-ppm` keeps its forwarding-fee meaning.
5. **Update `--help` text** on all three binaries to reflect new flags.
6. **No `ss_factory_policy_t` in the lib.** No policy validators. Just discrete parameters and well-named struct fields.

---

## 11. Open questions / v2 candidates

Not in v1, but worth tracking:

- **`lsp_advertises_via_liquidity_ad`** — BOLT-12 liquidity ads as an alternative to Nostr vouches. Duplicative for now.
- **`min_joiner_uptime_proof`** — Would require a separate uptime-proof protocol. Defer.
- **`max_conn_rate` / `max_handshakes`** — Currently CLI flags; LSP operational only. Could become advertised in v2 if useful.
- **Per-rotation policy changes** — Some fields could be mutable across rotations (e.g., updating `forward_fee_ppm` for new joiners while preserving existing clients' rates). v1 keeps these immutable for simplicity.
- **Setup fees** — v1 is pure-routing; a one-time admission fee (`lsp_fee_sat` / `lsp_fee_ppm` / `join_fee_sat`) was prototyped in earlier drafts but removed because it has no lib infrastructure. Could return in v2 with proper accounting.
- **Time-of-day / day-of-week pricing** — `forward_fee_ppm` could vary by time. Defer.
- **Failover / multi-LSP** — A policy that lets a joiner's channel migrate between LSPs operating the same factory. Out of scope for v1.
- **Reputation system** — Joiner-side trust scoring of LSPs based on prior behavior. Wallet-local for now; not factory policy.

---

## 12. Implementation checklist

**Layering reminder** (v1 draft 3 architecture correction): the policy struct + validators + codec live in the **plugin's source tree**, not the lib's. The lib's work is just **adding the new CLI flags + struct fields** the plugin needs to populate. See §7 and §10.5 for the full architecture rationale.

### 12.1 SuperScalar lib (`8144225309/SuperScalar`) — flag + parameter additions only

The lib has **no `ss_factory_policy_t`, no policy validators, no TLV codec.** It only needs to expose discrete parameters that the plugin will populate from its policy struct.

- [ ] **Add the ~37 new CLI flags** enumerated in §10.5 across the three binaries:
  - `tools/superscalar_lsp.c` — ~29 new flags (tree shape extensions, lifecycle, economics, channel options, HTLC policy, joiner admission, watchtower, PS chain, migration, routing, lifecycle commitments)
  - `tools/superscalar_watchtower.c` — ~6 new flags (watchtower mode, poison strategy, scan depth, reorg alarm, reorg response, breach response fee rate)
  - `tools/superscalar_client.c` — ~2 new flags (client-side mirrors for policy fields the client validates: rotation_interval_blocks, max_capacity_per_join_sat for client's own admission)
- [ ] **Extend `ss_config_t`** (`include/superscalar/superscalar_sdk.h`) with any runtime-config fields not currently parameterized (e.g., for fee strategy + min rate, watchtower mode, etc.)
- [ ] **Add `ss_factory_create_args_t`** (or extend whatever struct factory_create takes today) to accept all tree shape + lifecycle + economics fields. **Do not collapse into a single "policy" struct** — keep parameters discrete; that's the layer boundary
- [ ] **Add `ss_watchtower_config_t`** struct passed to `watchtower_init` carrying watchtower-policy-derived parameters (mode, poison strategy, fee rate, scan depth, reorg config)
- [ ] **Split `--arity` into `--arity` (mode) + `--leaf-arity`** where appropriate (see §10.5.2)
- [ ] **Update `--help` text** on all three binaries
- [ ] **Add unit tests** that the new flags parse + propagate to lib structs correctly
- [ ] **No changes to slim extraction list** in plugin's `build-plugin.sh` — the lib doesn't gain new modules, just new flag parsing + struct fields

### 12.2 Plugin (`superscalar-cln`) — owns the policy

Everything policy-related lives here.

- [ ] **Create `factory_policy.h` + `factory_policy.c`** in plugin's own source tree — struct definition, defaults, validators (`ss_policy_validate_struct`, `ss_policy_validate_advance`, `ss_policy_validate_join_request`, `ss_policy_validate_htlc`, plus the `ss_plugin_validate_*` wrappers per §7.1)
- [ ] **Create `factory_policy_codec.c`** — TLV encode/decode (only diff from defaults), per §5
- [ ] **Persist policy** in CLN datastore under `superscalar/factories/{instance_id}/policy/`
- [ ] **Extend `factory-create` RPC params** to accept the full policy field set
- [ ] **Add `factory-list-public` RPC** returning expanded JSON per §6
- [ ] **Add `SS_SUBMSG_FACTORY_INFO_REQUEST` / `RESPONSE` handlers** in custommsg dispatch (per §5.1)
- [ ] **Populate lib config structs from policy** at every lib-call site (per the sketch in §7.2)
- [ ] **Wire policy lookup** into `htlc_accepted` hook, `openchannel` hook, `block_added` hook, `custommsg` handlers
- [ ] **Update `CONFORMANCE.md`** to cite policy spec
- [ ] **Add plugin-side unit tests** for every validator path (cross-field invariants, range checks, banlist, allowlist, dust threshold, rotation cadence enforcement)

### 12.3 Wallet (`superscalar-wallet`) — TS mirror + UI

- [ ] **TypeScript mirror** of the policy struct in `apps/frontend/src/types/factory-policy.type.ts`
- [ ] **`RendezvousService.fetchFactoryPublic(lnNodeId)`** → calls plugin via CLN to dial peer (Tier 2 work)
- [ ] **ConnectList row fill-in logic** that calls the above and populates capacity/slots/fees/lifecycle columns
- [ ] **Wallet-local filter UI**: "show only factories matching my preferences" (uses `RendezvousState.browseCache`)
- [ ] **Display policy in selected-row drawer** with section headers (one per category)
- [ ] **Extend Host Factory dialog** (PR #11) with new sections: Joiner admission (allowlist + ban list), Watchtower (mode + strategies), PS chain settings, Migration paths, Routing/forwarding, Lifecycle commitments
- [ ] **"Required reachability" derived metric** UX (per §3.1) — single user-facing number derived from policy fields
- [ ] **CI check**: TypeScript types stay in sync with plugin's `factory-list-public` JSON schema

### 12.4 Docs

- [ ] **Primary spec home** decided (this doc — proposed `superscalar-wallet/docs/FACTORY_POLICY_V1.md` per maintainer call)
- [ ] **Pointer from `8144225309/SuperScalar/README.md`** to the spec for lib developers implementing the flag additions
- [ ] **Pointer from `8144225309/superscalar-cln/README.md`** to the spec for plugin developers implementing the policy ownership
- [ ] **`superscalar-docs/how-it-works/policy-negotiation.md`** — joiner-LSP handshake flow (separate doc for the wire-level negotiation)
- [ ] **Update `WALLET_INTEGRATION.md`** of `soup-rendezvous` to note that factory params are NOT on Nostr (already implicit; make explicit)

### 12.5 Order of operations

1. **Lib first** — add the ~41 new CLI flags + struct fields. Plugin can't populate parameters that don't exist. Each new flag is independently testable.
2. **Plugin next** — adopt policy struct + validators + RPCs + custommsg handlers + persistence. Populates lib config from policy at each call site.
3. **Wallet last** — TS mirror, ConnectList fill-in, dialog extensions, filter UI.

Three repos, three phases. **Parallelizable:** lib developer adds flags while plugin developer scaffolds RPC handlers against a placeholder; they integrate when both ready. Wallet TS work depends on the plugin's `factory-list-public` JSON schema being stable.

Estimated effort with dedicated developers: lib ~1-2 weeks (mostly mechanical flag additions), plugin ~2-3 weeks (validators + persistence + RPCs + custommsg), wallet ~1-2 weeks (TS mirror + UI extensions + ConnectList fill-in).

---

## 13. Authorship and changelog

- **v1 draft 1** (2026-05-14): initial 57 fields, drafted by adaptation-gap analysis collecting fields from PR #11 dialog, plugin README schema, CLI flags, soup-rendezvous protocol, PR #159 cheat-engine work, PR-D wire-ceremony, CL1-CL8 series, PR #163 fee clamp, PS canonical shift, and superscalar-docs `extensions/` content.

- **v1 draft 2** (2026-05-14): expanded to 62 fields. Corrected exclusion of three "LSP-operational" fields (`auto_host_next`, `ladder_cadence_blocks`, `auto_rotate_periodically`) — joiner-uptime impact makes them advertised soft commitments. Added two paired hard-floor fields: `rotation_interval_blocks` (joiner-enforceable hard backstop on rotation frequency) and `expected_rotation_blocks` (soft informational hint). Added new "enforcement strength" taxonomy (§4.0.1) distinguishing `hard` / `soft` / `joiner_enforceable_hard` with field-to-strength lookup (§4.0.2). Added new TLV range 0x0C00–0x0CFF for the Lifecycle commitments category (§4.13). Added per-ceremony timeout clarification to §4.3.4. Added §3.1 signer-count table per arity_mode and per ceremony type to disambiguate the "do all signers need to be online?" question.

- **v1 draft 3** (2026-05-14): **architectural layer correction.** The `ss_factory_policy_t` struct, validators, and TLV codec move from "lib responsibility" to **plugin responsibility**. The lib has no concept of "policy" — it accepts discrete parameters (via CLI flags + extended `ss_config_t` + new `ss_factory_create_args_t` and `ss_watchtower_config_t`). The plugin owns the policy struct and populates lib config at each call site. Affected sections: §3 (architecture note), §7 (validators relocated from §7.1 lib to §7.1 plugin; new §7.2 "Lib parameter touch points"), §12 (lib checklist becomes flag-addition list; plugin checklist absorbs all policy-struct work). Added new §10.5 "CLI and lib API parameter mapping" — 62-row table enumerating every policy field against existing CLI flags on `superscalar_lsp`, `superscalar_client`, `superscalar_watchtower`. Audit reveals ~10 fields covered by existing flags, ~9 partially covered (need extension/rename), ~41 require new CLI flags, ~2 derived. §10.5.15 is the lib developer's punchlist.

- **v1 draft 4** (2026-05-14): **field-count rationalization (62 → 57) + cross-field invariants section.** Dropped 5 fields after design review:
  - `lsp_fee_sat`, `lsp_fee_ppm`, `join_fee_sat` (§4.4 Economics): v1 is **pure-routing**. Users do not pay to join a factory; they pay LN routing fees on the resulting channels. Setup-fee fields removed; §4.4 preamble documents the revenue model. The existing `--routing-fee-ppm` CLI flag retains its forwarding-fee meaning (§10.5.12 / `forward_fee_ppm`).
  - `proof_tier_required` (§4.7 Joiner admission): proof tier is a property of the LSP's coordinator vouch (proof-of-channel ⊂ proof-of-utxo ⊂ proof-of-peer, transitively visible via Nostr kind 38101), not a per-factory policy setting. Wallets filter on tier when browsing the rendezvous list; LSPs do not advertise it in the factory policy.
  - `max_advance_count_per_leaf` (§4.9 PS chain): chain length is **dust-bounded**, not statically capped. The combination of `advance_dust_warning_threshold_sat` and the LSP's per-advance discretion is sufficient; a static cap is the wrong abstraction.
  - Added new **§4.14 Cross-field invariants** documenting validator-enforced relationships between fields: tree-shape coherence (arity_mode ↔ arity values), lifecycle/capacity bounds, joiner admission coherence, lifecycle commitment coherence, and routing coherence. Spells out which combinations the plugin validator must reject.
  - Updated §4.0.2 enforcement-strength lookup, §4.3.4 ceremony scope, §4.4 economics, §4.6.4 cltv research caveat, §4.7 joiner admission count, §4.8.6 reorg strategy semantics, §4.9 PS chain rationale (pre-APO multi-party signature leakage as why chains chain), §6 JSON example, §7.1 validator pseudo-code, §7.2 lib API populate sketch, §9 defaults table, §10 code mapping (35 → 32 of 57 from existing sources), §10.5.4 / .7 / .9 mapping subsections, §10.5.14 summary (was ~41 ❌, now ~37), §10.5.15 punchlist.

- v1.1 candidates: any new fields surfacing during implementation review.

- v2 trigger: when an incompatible change is needed (renamed/removed fields, semantic changes, new wire envelope).

---

**End of spec.**
