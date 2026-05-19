/**
 * Client signing preferences — thresholds that govern when the plugin
 * refuses to sign an incoming FACTORY_PROPOSE.  Mirrors the plugin C
 * struct ss_client_signing_prefs_t (factory_policy.h).
 *
 * The validator runs in the plugin against the 12 joiner_enforceable_hard
 * fields from FACTORY_POLICY_V1 §4.0.2; these prefs are the user-tunable
 * thresholds the validator checks against.
 *
 * Persisted via the plugin RPC pair:
 *   client-signing-prefs-get → returns current prefs (or defaults)
 *   client-signing-prefs-set → persists into the plugin's KV
 *
 * Until those RPCs land the UI falls back to local defaults so the
 * component is usable in isolation.
 */

export enum ProofTier {
  CHANNEL = 0,
  INVOICE = 1,
  NONE = 2,
}

export type ClientSigningPrefs = {
  /* HTLC sizing */
  max_htlc_min_sat: number;                  // default 10_000
  min_htlc_max_sat: number;                  // default 100_000

  /* HTLC concurrency */
  min_max_concurrent_htlcs: number;          // default 5
  min_max_in_flight_msat: number;            // default 1_000_000 (1k sat)

  /* CLTV expiry */
  max_min_final_cltv_delta: number;          // default 200 (~33 hr)
  max_cltv_delta_forward: number;            // default 200

  /* Capacity */
  max_min_capacity_per_join_sat: number;     // default 1_000_000
  min_max_capacity_per_join_sat: number;     // default 10_000

  /* Proof tier */
  require_strict_proof_tier: boolean;        // default true
  max_proof_tier: ProofTier;                 // default INVOICE

  /* Rotation cadence */
  min_rotation_interval_blocks: number;      // default 144 (~1 day)

  /* Tier B rollover */
  require_tier_b_rollover: boolean;          // default false

  /* State replay defense window */
  min_state_replay_defense_window_blocks: number; // default 288 (~2 days)
};

/** Canonical defaults — must stay in sync with ss_client_signing_prefs_init_defaults. */
export const DEFAULT_CLIENT_SIGNING_PREFS: ClientSigningPrefs = {
  max_htlc_min_sat: 10_000,
  min_htlc_max_sat: 100_000,
  min_max_concurrent_htlcs: 5,
  min_max_in_flight_msat: 1_000_000,
  max_min_final_cltv_delta: 200,
  max_cltv_delta_forward: 200,
  max_min_capacity_per_join_sat: 1_000_000,
  min_max_capacity_per_join_sat: 10_000,
  require_strict_proof_tier: true,
  max_proof_tier: ProofTier.INVOICE,
  min_rotation_interval_blocks: 144,
  require_tier_b_rollover: false,
  min_state_replay_defense_window_blocks: 288,
};

export type GetSigningPrefsResponse = {
  prefs: ClientSigningPrefs;
  is_default: boolean;
};

export type SetSigningPrefsResponse = {
  ok: boolean;
};
