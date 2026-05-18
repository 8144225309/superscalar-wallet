# Reply to lib team — persist_* API + PENALTY_BURN follow-up + architecture clarification (2026-05-18)

Thanks for the v34 schema landing (PR #252) and for the PENALTY_BURN clarification with file:line refs. Reply below has three helper asks, one decision request, one key-convention question, and acknowledges your correction.

## 1. Please add three persist_* helpers

### 1a. `persist_scan_participants` — for crash recovery

We need an efficient per-ceremony participant query: "which participants are in phase X for ceremony Y?" Used to find who still needs a retransmit after a plugin restart. Without it, the plugin has to load every row and filter in C code.

```c
typedef bool (*participant_cb)(const uint8_t pubkey[33],
                                int phase,
                                const uint8_t *nonce_opt,
                                const uint8_t *partial_sig_opt,
                                void *ctx);

int persist_scan_participants(persist_t *p,
                              uint8_t ceremony_id[8],
                              int filter_phase,   // -1 = all phases
                              participant_cb cb,
                              void *ctx);
```

Pairs naturally with the `persist_scan_in_flight_ceremonies` you already proposed.

### 1b. `persist_get_last_finalized_ceremony` — for parent-link validation (high-frequency)

The sequencing safety invariant requires this lookup on **every** incoming `CEREMONY_START`: each new ceremony carries a `parent_ceremony_id` field, which must match the most recent FINALIZED ceremony for that factory. Mismatch = refuse.

Since this fires on every incoming wire CEREMONY_START, an indexed direct lookup beats scanning-and-filtering by a lot.

```c
int persist_get_last_finalized_ceremony(persist_t *p,
                                         const uint8_t factory_instance_id[32],
                                         uint8_t out_ceremony_id[8],
                                         uint32_t *out_finalized_at_block);
```

Returns the most recent FINALIZED ceremony for the factory; sentinel (e.g., out_ceremony_id all-zero) if no prior finalized ceremony (factory is just past INITIAL).

### 1c. `persist_scan_ceremonies_by_factory` — for audit/list RPCs

The plugin exposes RPCs like `factory-ceremony-list` for operator/dashboard inspection. Needs a broader scan than `persist_scan_in_flight_ceremonies` (which only returns in-flight rows):

```c
typedef bool (*ceremony_cb)(const uint8_t ceremony_id[8],
                             int ceremony_type,
                             int state,
                             uint32_t started_at_block,
                             uint32_t deadline_block,
                             void *ctx);

int persist_scan_ceremonies_by_factory(persist_t *p,
                                        const uint8_t factory_instance_id[32],
                                        int filter_state,   // -1 = all states
                                        ceremony_cb cb,
                                        void *ctx);
```

Same callback shape as the in-flight scan; just doesn't pre-filter by state.

## 2. Pick soft vs hard enforcement of "persist phase before aggregate"

You flagged the rule yourself: write `phase=SIGNED` before calling the aggregate function, or the dual-signature trap window opens on a crash.

Two options for how `persist_set_ceremony_aggregated_nonce` (or equivalent) enforces it:

- **Soft:** trust callers. Docs + code review only.
- **Hard:** function reads participant phases first (via 1a above) and refuses to write the aggregated nonce if any participant is still in `NONCED`. Cheap defensive check at the library boundary.

Your pick. We'll respect either; honestly lean hard given the consequences.

## 3. Factory key convention question

Quick check on API shape. Your existing `factories` table uses `id INTEGER PRIMARY KEY` (autoincrement); the v34 ceremony tables key off `factory_instance_id BLOB NOT NULL` (the 32-byte HSM-derived ID).

For the helpers above (and others the plugin will call) — should we always pass the BLOB `factory_instance_id`, or sometimes the INTEGER `id`?

We'd prefer instance_id everywhere on the API boundary (the plugin doesn't need to know about the internal int row IDs). If you'd like an `iid_to_id` translator available too for places where the INTEGER form is operationally cheaper, that's fine; just want to know the convention.

## 4. PENALTY_BURN — got your correction, design updated

Thanks for the file:line walkthrough (`src/factory.c:239`, `:3154`, `:3229`, `:3241`). Our prior draft treated PENALTY_BURN as its own MuSig2 ceremony at breach time. That was wrong; the burn TXs are pre-signed at leaf-state-advance during normal INITIAL/ROTATE ceremonies using N-of-N MuSig key-path, and the watchtower just broadcasts the existing signed bytes at breach time.

Our `CEREMONY_DESIGN.md` now reflects this:

- PENALTY_BURN dropped from the v1 ceremony types list. v1 set is: INITIAL, ROTATE, FORCE_OUT, ABORT.
- Type byte 0x09 reserved/unused.
- Penalty path is a "watchtower broadcasts pre-signed bytes on trigger" — same primitive as our pending wallet features for auto-sweep and pre-signed subscriptions (issues #28 and #10 in `superscalar-wallet`). One mechanism, multiple consumers.

## 5. Architectural clarification (for your planning)

If you were considering adding `lsp_operator_prefs` / `client_signing_prefs` tables to your schema — please don't. We re-drew the line: **your DB stays purely crypto + ceremony round bookkeeping**. All server/client coordination state (LSP join queue, client outgoing joins, factory-list-from-user-perspective, factory policy snapshots, operator prefs, signing prefs) moves into the wallet's own SQLite, not yours. You don't need policy-shaped tables.

Same for Task #72 (plugin pivot off CLN datastore). Most of the rows we currently keep in CLN datastore turn out to be server/client coordination, so they go to wallet SQLite. Your DB only receives the crypto/ceremony-shaped rows.

## 6. Status

- v34 ceremony tables: landed ✓
- Outstanding from us: three helpers + one decision + one key-convention question above
- Outstanding from you: helpers PR when convenient (no rush)
- Task #72 on our side will use your existing API for the crypto-shaped rows; rest goes wallet-side

Thanks again — the PENALTY_BURN correction caught a real misunderstanding in our design.
