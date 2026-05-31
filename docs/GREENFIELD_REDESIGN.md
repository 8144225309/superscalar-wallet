# SuperScalar Wallet — Greenfield Redesign Proposal

If we were building this from scratch today knowing what we know now, here's what would change. Companion to `USER_FLOWS.md` (the as-built catalog). Numbered observations U1-U13 there map directly to fixes here.

This is a **vision document**, not a roadmap. Trade-offs and reasoning are surfaced honestly so each change can be argued against. None of this is a commitment; it's a "what would clean look like" reference.

---

## Anchoring principles

The current wallet is a fork of Blockstream's `cln-application` (`soupwallet` brand). It inherited a CLN-centric structure: routes are organized around CLN primitives (peers, channels, payments) rather than user tasks. The factory surface (`/factories/*`) was bolted on as a parallel structure.

If we started over we'd anchor the UI on these instead:

1. **Role-first.** The user picks "I'm a participant" or "I run an LSP" once at first-run. The entire shell reshapes — nav, defaults, surfaces hide/show.
2. **Task-oriented surfaces, not entity-oriented.** Don't make the user navigate to "/factories" and then figure out what they wanted to do. Make the top-level nav be "Join a factory" / "Host a factory" / "Send/receive" / "History".
3. **One state machine model, surfaced as a bucket.** Hide the 5 orthogonal state dimensions behind the 9-bucket `factoryStatus()` everywhere except an opt-in "Advanced" disclosure.
4. **Push, not poll.** The current 5-second `useFactoryEventStream` poll works but the UI never feels live. Push-first via WebSocket from the wallet backend (memory `project-realtime-and-tier2` documents the partial implementation).
5. **Mobile-first.** Channel factories are most useful on phones (per memory `project-wallet-gap-audit` Tier 2 item #17). Today's Bootstrap layout is desktop-first with responsive bolt-ons.
6. **First-run guided setup, not empty dashboard.** A new user should see a wizard, not an "Open Factories" panel that says "Active node's network not covered by any configured coordinator."

---

## Architecture deltas

### Frontend stack

| Today | Greenfield | Why |
|---|---|---|
| React + Redux Toolkit + React-Bootstrap | React + Zustand + Tailwind + Radix primitives | Redux ceremony for small slices is overhead; Zustand is ~200 LOC for what `factoriesSlice + factoryEventsSlice + clnSlice + rendezvousSlice` do. React-Bootstrap's component conventions (Dropdown.Item, autoClose semantics) caused real today-bugs (#158). Radix is unstyled-with-primitives — less fighting your component library. |
| Polling via custom hooks | XState machines per protocol surface + WebSocket | The 5 orthogonal factory state dimensions are EXACTLY what XState was built to model. Today the validity of state transitions is implicit in component conditionals. XState lets you visualize/audit/test them. |
| Component-local state for forms | react-hook-form + zod | `useInput` hook is fine but doesn't compose for the 12-field SigningPrefs editor. zod gives shared validation across client + server. |
| react-bootstrap modals | Radix Dialog | Today's modals have inconsistent close behaviors (some Esc, some click-outside, some both). Radix gives one consistent contract. |

### Backend stack

| Today | Greenfield | Why |
|---|---|---|
| Express + csurf + express-rate-limit | Hono + native CSRF + per-route rate-limit middleware | csurf is deprecated. Hono runs on Node and edge — Cloudflare Workers for a hosted version. |
| Commando WebSocket only (via lnmessage) | Commando + gRPC + REST adapter abstraction | One transport works but gRPC is faster on local sockets, REST is friendlier for non-Node integrations. NodeManager already abstracts this; just finish the multi-transport split. |
| JWT cookie auth | WebAuthn / passkey + optional JWT fallback | Passwords are the worst UX in the wallet. WebAuthn means hardware-backed device auth, no password hashing concerns, no SHA-256-pre-hash-on-client gymnastics. |
| File-based config (`config.json`) | SQLite for config + audit log + metrics | Three files today (`config.json`, `audit-log.jsonl`, in-memory metrics) all want indexed lookup, atomic write, durable storage. SQLite is one file with WAL. |
| audit-log.jsonl + metrics in-process | Same SQLite, exposed via the same endpoints | Don't change the endpoints, just back them with a real store. |

### State model

The factory has 5 dimensions today. Greenfield collapses to ONE finite state machine — the **lifecycle** — with explicit transition guards. Other dimensions become derived properties:

```
   AwaitingJoins
        │
        │ (enough joiners)
        ▼
   ReadyToTrigger
        │
        │ (LSP triggers OR auto-trigger block)
        ▼
   CeremonyInFlight ─── (refuse / timeout) ───▶ Failed
        │
        │ (psigs collected)
        ▼
    Signed
        │
        │ (LSP opens channels)
        ▼
    Active ─── (rotate) ──▶ Active (epoch+1)
        │
        │ (lifetime - dying period)
        ▼
    Dying
        │
        │ (cooperative close)            (force close)
        ▼                                       │
   ClosedCooperatively      ClosedUnilaterally ◀┘
        │                                       │
        ▼                                       ▼
                  Closed (terminal)
```

`ceremony`, `dist_tx_status`, `rotation_in_progress` all become *attributes* of the current state, not orthogonal states. The frontend never branches on them; it branches on the state name and reads attributes for display.

XState makes the transition guards explicit. Today they're spread across `LspOperatorConsole`, `FactoryDetail`, and plugin-side checks. Disagreements between client/LSP views (we hit one today with `f762b371` — LSP saw `active`, client saw `signed`) become impossible because both clients run the same machine off the same event stream.

---

## UI restructure

### New top-level navigation (replaces current header + nav-pill split)

**Client role:**

```
┌─────────────────────────────────────────────────┐
│  My Wallet      Connect      History    [Me ▼] │
└─────────────────────────────────────────────────┘
```

- **My Wallet** = current `/cln` (BTC + Lightning balances + channels including factory channels) + factory-specific status pinned at top ("3 factories active, 1 awaiting signature")
- **Connect** = the unified discover-and-join surface (collapses U1's three paths)
- **History** = unified activity feed: payments + factory events + node events (closes U12)
- **[Me ▼]** = profile picker + settings dropdown combined

**LSP role:**

```
┌─────────────────────────────────────────────────┐
│  Dashboard     Factories     Peers     [Me ▼]  │
└─────────────────────────────────────────────────┘
```

- **Dashboard** = at-a-glance: factories needing action (review queue, signed-but-not-opened, breach watch), expiry ladder, total inbound liquidity sold this month
- **Factories** = current `/factories` content but with the dashboard pulled out
- **Peers** = current `/factories/peers`
- **[Me ▼]** = profile picker + settings

**Switching roles** flips between layouts. The role is per-profile (each NodePicker entry carries `defaultRole: client | lsp`) so flipping the active profile flips the layout.

### "Connect" — the unified discover surface (fixes U1)

One screen, one input box:

```
┌────────────────────────────────────────────────┐
│  Join a factory                                │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ Paste an LSP pubkey, invite URL, or npub │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Or browse LSPs advertised on Nostr ▾          │
│                                                │
│  Recent attempts (4)                           │
│  ─────────────────                             │
│  …                                             │
└────────────────────────────────────────────────┘
```

The input auto-detects:
- 66 hex chars → pubkey, opens manual connect flow
- `superscalar://` URL → opens accept-invite flow
- `npub1…` → opens vouch-lookup flow
- Anything else → friendly error

Below the input, the rendezvous list is collapsed by default but expandable.

### "Review" surface — promoted from buried banner to first-class (fixes U2)

Persistent at the top of every page, only visible when there's something to act on:

```
┌────────────────────────────────────────────────┐
│ ⚠  1 proposal needs your review →             │
└────────────────────────────────────────────────┘
```

Click → side-panel slides in with `ReviewProposalModal` content but without the modal trap. User can navigate around the wallet while leaving it open as reference.

### LSP "needs action" dashboard (fixes U3)

The dashboard becomes the queue:

```
┌────────────────────────────────────────────────┐
│  Needs your attention                          │
│                                                │
│  ▸ 2 factories signed, ready to broadcast      │
│    [Open Channels]                             │
│                                                │
│  ▸ 7 join requests below auto-accept threshold │
│    [Review queue]                              │
│                                                │
│  ▸ 1 factory expiring in 4 days                │
│    [View ladder]                               │
└────────────────────────────────────────────────┘
```

Each row links to the existing surface but the dashboard is the FIRST screen, not the last. The user never has to remember which sub-tab they were on.

### Rename to make roles explicit (fixes U4)

- "LSP Prefs" → "My LSP defaults" / "Liquidity policy"
- "Signing Prefs" → "My signing rules" / "Trust thresholds"

Better still: only show the LSP one when the user has the LSP role enabled.

### State display: bucket-first, raw-on-disclosure (fixes U5)

FactoryDetail's identity section becomes:

```
┌────────────────────────────────────────────────┐
│  factory_a823 (LSP role)                       │
│  ● Active · epoch 1 · 1 channel · expires in   │
│    11 days                                     │
│  ▸ Show technical details                      │
└────────────────────────────────────────────────┘
```

The "technical details" disclosure exposes lifecycle / ceremony / dist_tx_status / etc. for operators debugging.

### Settings → Diagnostics tab (fixes U6)

A new tab under Settings holds:

- **Audit log viewer**: paginated `/v1/shared/audit-log` browser with filter by event type
- **Metrics**: pretty-rendered Prometheus counters with sparkline
- **Wallet daemon health**: free RAM, ws connection state per profile, plugin liveness
- **SQL Terminal** (current modal moves here)

### Notifications panel (fixes U11 + U12)

A single "bell" icon in the header opens a panel with grouped sections:

- **Action needed**: PROPOSED-state factories, JOIN_QUEUE_QUEUED entries (LSP), MISSED ceremonies
- **Recent activity**: factory events, channel events, payment events from the last 7 days
- **Issues**: breach epochs detected, peer ban changes, plugin RPC failures

Replaces `HeldProposalsBanner` + `MissedCeremoniesBanner` + `JoinQueueBanner` + `PendingProposalsCard`.

### First-run flow (fixes U13)

```
┌────────────────────────────────────────────────┐
│  Welcome to SuperScalar Wallet                 │
│                                                │
│  What are you here to do?                      │
│                                                │
│  ┌─────────────┐  ┌─────────────┐              │
│  │  Get a      │  │  Host       │              │
│  │  Lightning  │  │  factories  │              │
│  │  channel    │  │  for others │              │
│  └─────────────┘  └─────────────┘              │
│  (most users)     (LSP operators)              │
└────────────────────────────────────────────────┘
```

→ Role-specific 3-step setup:
- Client: connect to LSP → set signing prefs → ready
- LSP: configure policy → host first factory → ready

After setup, user lands on their role dashboard with empty-states that explain what to do next.

---

## Test strategy

Greenfield rebuild lets us redo the test layer too.

| Layer | Today | Greenfield |
|---|---|---|
| Unit | vitest (backend) + jest via CRA (frontend) | vitest everywhere |
| Component | testing-library | testing-library + Storybook with interaction tests |
| Integration | manual smoke + ad-hoc puppeteer scripts in `apps/frontend/e2e/` | Playwright with per-role test suites + a regtest CI fixture |
| E2E | the demo VPS run we did today | CI-gated Playwright suite running against an ephemeral regtest fixture + plugin |
| Visual regression | none | Storybook + Chromatic for component diffs on PR |

The `apps/frontend/e2e/` puppeteer scripts (R5.1) become the seed for the Playwright suite. They already cover the golden path; just need parameterization and CI wiring.

---

## Demo / production split

Today the wallet is one binary that talks to whatever CLN you point it at. Greenfield separates **demo mode** explicitly:

- `--demo` flag (or `APP_DEMO=true` env var)
- In demo mode: dashboard has a "Demo banner" at top, sample data injected for empty states, the "Mine 6 blocks" button appears in regtest, click-to-fund test addresses
- Production mode: none of that, locked down

This makes onboarding new operators MUCH easier — the demo gives them a sandbox before they commit to mainnet.

---

## Things I'd NOT change

Worth being explicit. These are right in the current design and survive the rewrite:

1. **The factory state buckets** (`factoryStatus()`). The 9-bucket collapse is correct; just needs to be the default view everywhere.
2. **The no-blind-signing gate** (A6 review proposal). The concept is right; just needs to be promoted from buried banner to first-class surface.
3. **The audit log JSONL format**. Append-only, scannable, rotates with `logrotate`. Just needs a UI viewer.
4. **The Prometheus metrics format**. Industry standard, tools exist. Just expose more counters (factory lifecycle transitions, ceremony durations, RPC failures by method).
5. **The plugin RPC contract**. CLN RPCs are stable, well-typed. The wallet's role is to be a thin UI; the plugin owns business logic. Keep this split.
6. **The CONFORMANCE.md tracking** for wire-type deviations. Documented exceptions to the bLIP-56 spec are correct; just need a UI surface (under Settings → About) showing which deviations are in effect.
7. **Per-profile factory plugin detection** (`detectFactoryPlugin`). The wallet correctly degrades gracefully on profiles without the plugin. Keep.
8. **Memory-backed audit log + metrics for now**. The "swap to SQLite" upgrade above is nice-to-have, not critical.

---

## Migration path (NOT immediate)

If we ever decide to do this for real, the path is:

1. **Stabilize the current wallet** (we're here today — 100+ PRs of polish + tests)
2. **Document everything** (this doc + `USER_FLOWS.md` are the start)
3. **Greenfield prototype** in a new repo or `superscalar-wallet-2` directory. Targets parity for the golden path only.
4. **Run both side-by-side** for 1-2 months on the demo VPS
5. **Cut over** when greenfield reaches feature parity for the 5 most-used flows
6. **Maintain current as security-fix-only** for 6 months
7. **Sunset current**

This is a 6-12 month investment if pursued. Most of today's wallet would be thrown away. **Worth it only if the product team commits to the role-first + task-first reorganization** — without that commitment, this is just a different framework with the same UX problems.

---

## Companion docs

- `USER_FLOWS.md` — the as-built action catalog (read this first)
- `CONFORMANCE.md` — wire-type deviations from bLIP-56 spec (different concern)
- `OPERATOR_RUNBOOK.md` — production operator guide (R7.5)
- `SUPERSCALAR_STACK.md` — the 5-repo map (R4.3)
