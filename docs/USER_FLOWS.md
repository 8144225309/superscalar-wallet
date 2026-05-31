# SuperScalar Wallet — User Action Map

Comprehensive catalog of every human action the wallet exposes, organized by role. Built from the as-deployed-2026-05-30 codebase (`main` HEAD `efff377` + #160 changelog fix). Use this as the planning reference for any UI/UX restructure: the action list, the surfaces those actions live on today, and the state model the user has to carry in their head to operate the system.

Companion doc: `GREENFIELD_REDESIGN.md` — what we'd build if we started over.

---

## Roles

- **Client / Joiner** — wants a Lightning channel by participating in a factory hosted by an LSP. Signs ceremonies. Receives channels. Routes payments.
- **LSP / Operator** — hosts factories. Accepts join requests. Broadcasts funding TXes. Manages peers. Sells liquidity.
- **Shared** — both roles touch the same wallet shell: auth, profile management, on-chain BTC, standard Lightning, bookkeeper, settings.

A single CLN node usually plays both roles across different factories. The wallet's NodePicker swaps which node it talks to; on the demo VPS there are two preconfigured profiles (`ss-demo-lsp` and `ss-demo-client`) so role-switching means profile-switching.

---

## Shared flows (S1-S7)

Both roles must complete these or they can't operate.

### S1. Authenticate

| Step | Surface | Notes |
|---|---|---|
| First-run: set password | `SetPassword` modal | SHA-256 hashed client-side before POST; server stores hash |
| Login | `Login` modal | Same pre-hash. JWT cookie issued, 24h TTL |
| Reset password | Settings → Reset Password → `SetPassword` modal (reset mode) | Requires current password unless first-run |
| Logout | Header → logout icon → `Logout` confirm modal | Clears 4 Redux stores; cookie cleared server-side |

### S2. Manage CLN node profiles (NodePicker, top-left header)

| Step | Surface | Notes |
|---|---|---|
| View active profile + alias + pubkey + status dot | Header (always visible) | Status dot: green=connected / red=error / amber=loading |
| Open profile dropdown | Click NodePicker | Shows all known profiles with per-row health dots |
| Switch active profile | Dropdown → click row | Clears 4 stores, refetches dashboard, switches commando target |
| Add a profile | (No UI today — POST `/v1/nodes/` or edit `node-profiles.json`) | Gap — should have an Add form |
| Remove a profile | (No UI today — DELETE `/v1/nodes/:id`) | Gap |
| Rescan / discover new profiles + refresh dots | Dropdown → "Rescan for Nodes" | After PR #158: stays open, toasts result, runs healthCheck on all |

### S3. On-chain BTC operations (`/cln/btc-wallet`)

- View spendable + reserved balance
- Generate deposit address (`BTCDeposit` modal: new address + QR + copy)
- Withdraw to address (`BTCWithdraw` modal: address + amount + fee rate)
- View BTC transaction history (paginated)

### S4. Standard Lightning operations (`/cln/cln-wallet`)

- View Lightning local / remote / pending / inactive balances
- Send LN payment (`CLNSend`: paste BOLT11 / BOLT12 offer / keysend pubkey; auto-decodes on blur)
- Receive LN payment (`CLNReceive`: choose Invoice or Offer mode; amount + description)
- View payments + offers list (paginated)

### S5. Standard channel management (`/cln/cln-wallet` → ChannelsCard)

- View all channels (active / pending / inactive bucketed)
- Open new standard channel (`ChannelOpen`: pubkey@host:port + amount + fee rate)
- View channel details (`ChannelDetails`: balances, capacity, scid, dust limit, mempool link)
- Close standard channel (Close button in ChannelDetails)

### S6. Bookkeeper / accounting (`/bookkeeper`)

- Account events timeline (cumulative balance per account, time-bucketed)
- Sats flow chart (inflow / outflow per period)
- Volume chart (routing aggregated by in/out channel)
- Each surface has DataFilterOptions: TimeGranularity + date range + zero-period toggle

### S7. Settings dropdown (header → Settings cog)

- Version / Show node ID / Glossary / What's new
- Connect wallet / SQL Terminal
- Reset Password / Export Config / Import Config
- Fiat Currency / Currency unit (SATS/BTC) / Fiat-beside-sats toggle
- Theme toggle (separate icon)

---

## Client flows (A1-A12)

What a participant does to join a factory and use its channel.

### A1. Discover an LSP (THREE entry paths — UX gap)

| Path | UI surface | When |
|---|---|---|
| Rendezvous discovery | `/connect` → "Open Factories" list | LSP has published vouches to Nostr relays |
| Manual connect | `/connect` → "Connect to LSP manually ›" → `ManualConnectModal` | Someone DM'd you `pubkey@host:port` |
| Invite link | `/connect` → "Join via invite link ›" → `AcceptInviteModal` (paste superscalar:// URL) | LSP shared a one-shot invite |

Output: a target LSP `pubkey` + optional `address` + optional pre-filled `iid`.

### A2. Browse host (see LSP's factories)

- Auto-triggered after A1
- Plugin RPC: `factory-browse-host`
- Surface: `JoinFactoryModal` opens with a table — per-factory iid, funding sats, capacity per leaf, participant count, lifecycle, ceremony state
- LSP's advertised policy + tier shown alongside

### A3. Pick a factory + submit join request

- In `JoinFactoryModal`: radio-select a row, enter requested capacity
- Submit → plugin RPC `factory-join-request`
- Returns: request_id + status

### A4. Track outgoing join attempts

- Surface: `/connect` → "My join attempts" card (`MyJoinAttemptsCard`)
- Statuses: sent / queued / accepted / signed / rejected / cancelled / timeout / already_member
- Plugin RPC backing it: `client-list-outgoing-joins`

### A5. Configure SIGNING preferences (`/factories/signing-prefs`)

The 12 `joiner_enforceable_hard` fields the client will reject proposals over:

| Section | Fields |
|---|---|
| HTLC sizing | max acceptable htlc_min_sat, min acceptable htlc_max_sat |
| HTLC concurrency | min acceptable max_concurrent_htlcs, min acceptable max_in_flight_msat |
| CLTV expiry | max acceptable min_final_cltv_expiry_delta, max acceptable cltv_expiry_delta_forward |
| Per-join capacity | min/max per-join capacity sats |
| Tier-B rollover | min epochs remaining, rotation cadence |
| State-replay defense | replay window blocks |

Plus three booleans:
- Sign automatically when policy passes validation (D.1 auto-sign toggle — load-bearing safety setting)
- Require strict proof tier (channel > utxo > peer)
- Require tier-B rollover

### A6. Review a B3 proposal (the no-blind-signing gate)

This is the **most important** client action.

- Triggered when LSP fires `factory-propose` and client's auto-sign is OFF (or validation FAILED)
- Surfaces:
  - `/factories` bottom: `PendingProposalsCard` (lists factories with ceremony=PROPOSED)
  - `/factories` bottom: `HeldProposalsBanner` (sticky alert)
  - Click → `ReviewProposalModal`
- Modal shows: advertised policy vs. your prefs in side-by-side table, validation result (PASS / FAIL with field-level reason), tier match
- Decision: **Approve** (signs ceremony) or **Refuse with reason** (LSP gets the reason on the wire)

### A7. Participate in MuSig2 ceremony

- Mostly automatic; client side is reactive
- UI feedback: `CeremonyProgress` stepper inside FactoryDetail
  - Creation: IDLE → PROPOSED → NONCES_COLLECTED → PSIGS_COLLECTED → COMPLETE
  - Rotation: ROTATING → ROTATE_COMPLETE → REVOKED
- No buttons to push if auto-sign is ON

### A8. Wait for LSP to broadcast + receive Lightning channel

- Client sees: factory transitions `signed → active`
- New channel appears in `/cln` → CLNWallet → ChannelsCard
- Live event arrives via `useFactoryEventStream` (polled every 5s with offline catchup)

### A9. Use the channel (route LN payments)

- Same as S4 (standard LN send/receive) but routes via factory channel
- Visible in CLN Wallet transaction list — they're indistinguishable from regular LN payments to the user

### A10. Watch missed / refused / expired ceremonies

- `/factories` bottom: `MissedCeremoniesBanner` (sticky info Alert)
- States rendered: MISSED (2) "you weren't online", REFUSED (3) "you declined earlier", EXPIRED (4) "ceremony aborted before quorum"
- Action: Dismiss per row (plugin RPC: `wallet-dismiss-sign-queue-event`)

### A11. Participate in rotation

- Triggered by LSP via `factory-rotate`
- Client side is reactive; uses same `CeremonyProgress` stepper
- Auto-sign rotations toggle in SigningPrefs controls whether the client signs without prompting

### A12. Close (exit factory)

- Cooperative: triggered from FactoryDetail Close button → distribution TX takes funds back on-chain
- Force / unilateral: client publishes their pre-signed exit chain (FactoryDetail Force Close button)
- Both flows go through a confirmation modal with safety classification (green/amber/red badge — `classifyCloseSafety()` — based on breach epochs, lifecycle, rotation_in_progress, expiry distance)

---

## LSP flows (B1-B13)

What an operator does to host factories and earn from inbound liquidity.

### B1. Configure OPERATOR preferences (global defaults)

- Surface: `/factories/operator-prefs` → `OperatorPrefs`
- Fields:
  - `auto_accept_threshold` (sats) — joins at-or-above auto-accepted
  - `min_contribution` (sats)
  - `max_contribution` (sats)
  - `required_reputation` (score; 0 = accept any)

### B2. Host a new factory

- Surface: `/factories` → "Host Factory" pill → `FactoryCreate` wizard
- Sections:
  - **Basics**: label, total funding, max clients, per-client capacity, LSP reserve per leaf, optional client pubkeys list
  - **Tree shape** (accordion): leaf channel type (pseudo-spilman / ln-penalty), leaf arity, PS subfactory arity
  - **Lifecycle & ladder cadence** (accordion): lifetime preset (production 30+3 / demo 7+2 / custom), ladder cadence hours, dying period, block-early count
  - **Lifecycle automation** (accordion): auto-host-next, auto-finalize-on-dying, auto-rotate-periodically, auto-accept-joiners
  - **Policy**: allow BOLT12, allow AMP, HTLC min/max sats, advertise on Nostr
- Submit → `factory-create` plugin RPC

### B3. Advertise on rendezvous (optional)

- During factory create: "Advertise on Nostr" toggle
- OR after the fact: `/connect` → Rendezvous settings accordion → manage coordinators (per network) + relays + tier caps
- Publishes vouch event (Nostr kind=38101) via `RendezvousService.prepareVouchEvent` + `publishSignedEvent`

### B4. Approve / refuse incoming joins

- Surface: `/factories/console` → `LspOperatorConsole`
- Per-row Approve / Refuse-with-reason (modal)
- **Bulk operations** (R3.2): select multiple rows → bulk Approve / bulk Refuse with shared reason

### B5. Trigger ceremony when ready

- When enough clients have joined → FactoryDetail → "Trigger Ceremony" button (`factory-trigger-ceremony` RPC)
- OR auto-fires at `force_start_block_offset` if set on create

### B6. **Open Channels** (broadcast funding TX) — headline milestone

- Critical: this is the moment a factory goes from "signed but no channels" to "real Lightning channels exist"
- Surface: FactoryDetail → "Open Channels" button (visible when `lifecycle=signed`)
- Plugin RPC: `factory-open-channels`
- Result: funding TX broadcast to mempool, channels open in CLN, factory transitions to `active`

### B7. Per-factory operator overrides

- Surface: FactoryDetail → `OperatorPrefsCard` (renders only when `is_lsp=true`)
- Same 4 fields as B1, scoped to this factory's iid
- Empty fields inherit from B1 defaults; "Inherited from global" badge surfaces this

### B8. Rotate factory

- Surface: FactoryDetail → "Rotate" button (visible when `lifecycle=active`)
- Plugin RPC: `factory-rotate`
- Increments epoch, refreshes breach watch window, doesn't touch on-chain
- Auto-rotate flag on B2 wizard makes this happen automatically per ladder cadence

### B9. Manage peers across all factories

- Surface: `/factories/peers` → `KnownPeers`
- Per-peer: pubkey + alias, reputation score (with -1 = banned sentinel), notes, lifetime totals (join requests, accepted, refused, sats opened, factory count)
- Actions: ban / unban toggle, set reputation (modal), edit notes (modal)
- Filter: All / Banned / Noted + free-text search

### B10. Watch breach events

- Surface: `/factories` sidebar → `BreachStatus` card
- Lists factories with `n_breach_epochs > 0`, renders the count in a danger Alert pill

### B11. Watch expiry + plan ladder rotations

- Surface: `/factories` sidebar
  - `ExpiryWarnings` — sorted soonest-to-expire, color-coded ProgressBar (danger ≤144 blocks ≈ 1 day, warning ≤432 blocks ≈ 3 days, success otherwise)
  - `LadderingTimeline` — horizontal visual of all factories' active windows

### B12. Close factory

- Cooperative: FactoryDetail → Close button → `factory-close-proposal` (everyone signs distribution TX)
- Force / unilateral: FactoryDetail → Force Close button → `factory-force-close`
- Both gated by `classifyCloseSafety()` — green/amber/red badge with hover-reason, plus confirmation modal explaining channel count, participant count, on-chain costs, breach claims

### B13. Discard failed / aborted factories

- Surface: FactoryList row → "Discard" button
- Only enabled when `canDiscard()` passes: lifecycle ABORTED or FAILED (or ceremony=FAILED), and `n_channels=0`, and `funding_txid` is all zeros
- Plugin RPC: `factory-forget`

---

## State the user has to mentally model

A factory has **5 orthogonal state dimensions**. Naive product = ~120 unique combinations.

1. **Lifecycle** (9 states):
   `init → awaiting_joins → ready_to_trigger → ceremony_running → signed → active → dying → expired`
   plus terminal: `aborted`, `failed`, 4 closed variants (`closed_cooperative`, `closed_unilateral`, `closed_externally`, `closed_breached`)

2. **Ceremony** (6+ states):
   `idle → proposed → nonces_collected → psigs_collected → complete`
   plus rotation: `rotating → rotate_complete → revoked`
   plus failure: `failed`

3. **Role per factory** (2): `is_lsp` (you host) vs `client` (you joined)

4. **Epoch** (numeric): `epoch` / `max_epochs` / `epochs_remaining`

5. **Dist TX status** (4): `none / signed / broadcast / confirmed`

The `factoryStatus()` helper (R2.3 unified-status pass) collapses all of this to **9 user-facing buckets** displayed in `FactoryList` + `FactoryDetail` header. This is the only place users should see the protocol-level state names; everywhere else they should see the bucket.

**Per-role mental model addenda:**

- **Client** must also track: auto-sign toggle (A5), proof tier requirement, per-factory rotation cadence, missed/refused/expired ceremony queue
- **LSP** must also track: auto-accept threshold, per-peer reputation, factory ladder schedule, breach watch obligations, sign queue persistence

---

## UX observations (today's pain points)

Numbered for cross-reference from `GREENFIELD_REDESIGN.md` and future PRs.

### U1. Three discover paths (A1) are the same user task

`/connect` has three entry buttons — rendezvous-list / Manual / Invite — for what the user thinks of as one thing: "I want to join a factory on some LSP." Should collapse into a single "Connect" surface that auto-detects what the user has (pubkey@host:port, superscalar:// URL, npub) from clipboard or input.

### U2. The most important client action (A6 review proposal) is buried

`PendingProposalsCard` + `HeldProposalsBanner` both surface PROPOSED-state factories at the **bottom** of `/factories`. This is the no-blind-signing gate — should be a top-of-page persistent notification with badge count, comparable to how a chat app surfaces unread DMs.

### U3. The LSP's headline action (B6 Open Channels) is buried inside FactoryDetail

The Open Channels button only appears inside FactoryDetail. An LSP browsing the `/factories/console` overview should see how many factories are in `lifecycle=signed` waiting for Open Channels and click directly.

### U4. Signing Prefs and Operator Prefs live as adjacent tabs

`/factories/signing-prefs` (client safety) and `/factories/operator-prefs` (LSP defaults) are completely different concerns but sit next to each other in `FactoriesNav` with similar names. Rename to make role explicit: "Client signing rules" / "LSP join policy".

### U5. 120-state-combination factory exposed raw

FactoryDetail shows `lifecycle`, `ceremony`, `dist_tx_status`, `rotation_in_progress`, `n_breach_epochs`, etc. as separate fields. Most users only need the bucket from `factoryStatus()`. Move raw fields to an Advanced / Debug section.

### U6. Audit log + metrics have endpoints but no UI

`/v1/shared/audit-log` (R7.8) returns JSONL; `/v1/shared/metrics` (R7.4) returns Prometheus text. Both are useful operator surfaces. A Settings → Diagnostics tab would let the operator see who did what without curl.

### U7. Discard button greys out without explanation

`canDiscard()` gate has 4 conditions. When a factory is undiscarable, the button is just disabled. A tooltip explaining which condition is blocking would save the user from confusion.

### U8. Profile switching is heavyweight

The S2 profile switch clears 4 Redux stores + refetches all dashboard data. This is the right semantic but feels slow on a fresh connect. A loading state that's chunkier (skeleton screens per section) would help.

### U9. NodePicker LSP profile shows `?` until manual probe

(Fixed in #158 — added on-mount `healthCheck()` so all profiles get real dots without rescan.)

### U10. Rescan closes the dropdown mid-scan

(Fixed in #158 — `autoClose='outside'` so the dropdown stays open during scan + result viewing.)

### U11. Three banner components stack at bottom of `/factories`

`HeldProposalsBanner`, `MissedCeremoniesBanner`, `JoinQueueBanner` + `PendingProposalsCard` all live in the same footer area. Visually competing. A single Notifications panel with grouped sections would be cleaner.

### U12. No global activity feed

Events are emitted (per `useFactoryEventStream`) but there's no "recent activity" panel. Users have to navigate to FactoryDetail of each factory to see what happened.

### U13. No first-run guide

R3.3 first-run wizard was cut. A new user logging in for the first time sees an empty dashboard with no orientation. Either a brief overlay tutorial OR a "Get started" empty state card would close this.

---

## Quick reference: every plugin RPC the UI calls

For developers writing new tests or fixing flows.

### Client-side
- `factory-browse-host`
- `factory-join-request`
- `factory-cancel-join`
- `factory-refuse-proposal` (with reason)
- `factory-approve-proposal`
- `client-list-outgoing-joins`
- `client-signing-prefs-get` / `client-signing-prefs-set`
- `wallet-dismiss-sign-queue-event`
- `wallet-list-sign-queue`

### LSP-side
- `factory-create`
- `factory-list` / `factory-detail` (via factory-list)
- `factory-trigger-ceremony`
- `factory-open-channels`
- `factory-rotate`
- `factory-close-proposal`
- `factory-force-close`
- `factory-forget` (Discard)
- `factory-approve-proposal` / `factory-refuse-proposal` (with reason)
- `wallet-get-operator-pref` / `wallet-set-operator-pref` (global + per-factory)
- `wallet-list-join-queue-by-status` / `wallet-count-join-queue-by-status`
- `wallet-list-known-peers` / `wallet-set-peer-reputation` / `wallet-set-peer-note`

### Shared event stream
- `wallet-list-events-since` (5s poll with offline catchup, drives the live status updates)
- `wallet-get-latest-event-id` (seed)

### Rendezvous (LSP advertise + client browse)
- `RendezvousService.fetchSettings` / `saveSettings` / `resetSettings`
- `RendezvousService.getLspIdentity` / `prepareVouchEvent`
- `fetchVouches` (Nostr relay query)
- `publishVouch` (Nostr relay publish)
