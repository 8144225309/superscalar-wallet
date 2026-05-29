# Client-Join demo (regtest walkthrough)

End-to-end walkthrough of a client joining a SuperScalar factory
hosted by an LSP, using two CLN nodes on regtest and the soupwallet
UI's profile dropdown to switch between LSP-perspective and
client-perspective views.

This is an operator-facing demo. For protocol-level recovery details
see the plugin's `factory_state_machine` docs.

## Prerequisites

- Two CLN regtest nodes (`alice` = LSP, `bob` = client), each with
  the `superscalar-cln` plugin loaded
- bitcoind in regtest mode, mined to give each node funds
- `soupwallet` running, with both nodes registered as profiles
- `APP_SINGLE_SIGN_ON=true` for demo simplicity (skip the auth gate)

The demo deploy at `/root/ss-walletdemo` is pre-configured for this;
the demo password is `demopassword` if you flip `APP_SINGLE_SIGN_ON=false`.

## Step 1 — open soupwallet on the LSP profile

1. Browse to the wallet's UI URL.
2. Click the profile dropdown (top-right of the header).
3. Select the `alice` profile.

You should see:
- Header alias = `alice`
- Dashboard shows alice's channels, funds, and any existing factories
- Sidebar nav shows Factories, with a Console link if alice is an LSP

## Step 2 — create a factory as the LSP

1. Click `Factories` in the nav.
2. Click `Create factory`.
3. Set:
   - Funding amount: `10_000_000` sat
   - Min clients to start: `1` (lets you start with just bob)
   - Force start: leave off
4. Click `Create`.
5. The factory enters `draft` → `proposed` lifecycle. It appears in
   the FactoryList under the "Awaiting joins" bucket (PR #68 added
   this bucket explicitly).

## Step 3 — share an invite link

1. Open the factory detail page (click the factory row).
2. Click `Invite` (the invite modal appears).
3. Copy the invite link (it embeds alice's pubkey + address + factory ID).
4. Optionally, render the QR code for mobile-to-mobile transfer.

Privacy note: the invite link can be `nostr:`-prefixed if rendezvous
is configured. See `docs/SECURITY_HEADERS.md` for the connect-src
posture that allows wss to nostr relays.

## Step 4 — switch to the client profile

1. Click the profile dropdown.
2. Select the `bob` profile.

Profile-switch UX:
- The dropdown dots indicate node health (red = down, green = up,
  dashed = unprobed). The probe is event-driven (PR #160) so the
  dot updates as health flips.
- After switch, the dashboard auto-refetches alongside the channel/
  funds pull in parallel (PR #68 polish).

You should see:
- Header alias = `bob`
- Dashboard shows bob's state, no factories yet

## Step 5 — bob accepts the invite

1. Click `Connect` in the nav.
2. Paste the invite link into the "Accept invite" field.
3. The wallet decodes it and shows alice's identity. Click `Join`.
4. Behind the scenes, bob's plugin runs `factory-join-request` (the
   wallet RPCs are wired in PR #121). The plugin auto-connects to
   alice if not already peered.

You should see:
- Toast: "Join request sent to alice"
- The factory appears in bob's `My join attempts` view (PR #152
  shipped this)
- Status begins as `pending`

## Step 6 — alice approves the join

1. Switch profile back to `alice`.
2. Open `LSP Operator Console` from the Factories nav.
3. bob's join request appears in the pending list with allocation
   summary.
4. Either:
   - Auto-sign was ON (default; PR #125): plugin signed automatically
     because bob's allocation passes `auto_accept_threshold`. The
     row shows `Approved`.
   - Auto-sign was OFF or the request is below threshold: click
     `Approve` (PR #126 wired the RPC). A toast confirms.

You should see:
- Sign queue updates (PR #128) — the factory's signing state advances
- Factory's lifecycle moves toward `proposed` → `ceremony_running`

## Step 7 — trigger the ceremony

1. Stay on alice.
2. Open the factory detail page.
3. Click `Trigger Ceremony` (PR #124 added this button).
4. The plugin fans out to all participants (just bob in this demo).
5. The MuSig2 ceremony runs end-to-end. On the demo box this takes <5s.

You should see:
- Lifecycle advances to `signed` then `active`
- Channels appear under the factory
- Both alice and bob can see the channels in their dashboards

## Step 8 — verify channels work

1. From alice, send a 1 sat invoice to bob via the channel.
2. From bob, pay the invoice.
3. Each side sees the htlc in their dashboard activity feed.

## What this demo proves

- The full host → join → sign loop works without manual RPC
  invocation
- Profile-switch UX is fast enough to demonstrate from one browser
- Auto-sign and manual approval both work
- The trustless signing path (post-v0.2 MuSig audit fixes, see
  [[project-musig-migration-noop]]) completes cleanly

## Recording the demo

For external demos:

1. Use `puppeteer` to drive the browser, capturing PNGs at each step
   (`apps/frontend/e2e/` after R5.1 lands)
2. Or screen-record the browser session
3. Add narration about what's happening in the plugin (separate
   from this user-facing walkthrough)

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Invite link doesn't decode | Check rendezvous config; manual paste of `pubkey@host:port?factory=…` should always work |
| Join request hangs | Plugin logs for `factory-join-request` — auto-connect may have failed |
| Auto-sign didn't fire | Check `auto_accept_threshold` and bob's `requested_capacity` |
| Ceremony fails | Plugin logs for MuSig2 step indices; lib's BIP-327 state machine |
| Channels don't open | After ceremony=complete, run `factory-open-channels` from alice |

## See also

- [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) for env vars and ops
- [SUPERSCALAR_STACK.md](SUPERSCALAR_STACK.md) for repo / role layout
- Plugin's `superscalar-cln/docs/RPC.md` for the underlying RPC surface
