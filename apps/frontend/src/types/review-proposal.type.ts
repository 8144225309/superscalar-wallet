/**
 * Shape returned by the plugin RPC `factory-review-proposal`
 * (shipped in superscalar-cln PR #63 alongside the B1.5 validator).
 *
 * The plugin maintains a small pending_proposals cache populated whenever
 * a FACTORY_PROPOSE wire message is parsed — INCLUDING refused proposals.
 * The wallet calls this RPC to render the no-blind-signing confirmation
 * modal: show the user exactly what the LSP wants them to sign, plus the
 * validator's verdict if it already ran.
 */

import { ClientSigningPrefs } from './signing-prefs.type';

export type ReviewProposalAllocation = {
  pidx: number;
  node_id: string;
  allocation_sats: number;
};

export type AdvertisedPolicy = {
  /* HTLC + capacity fields the joiner cares about — mirrors the
   * joiner_enforceable_hard set per FACTORY_POLICY_V1 §4.0.2. */
  htlc_min_sat?: number;
  htlc_max_sat?: number;
  max_concurrent_htlcs_per_channel?: number;
  max_in_flight_msat_per_channel?: number;
  min_final_cltv_expiry_delta?: number;
  cltv_expiry_delta_forward?: number;
  min_capacity_per_join_sat?: number;
  max_capacity_per_join_sat?: number;
  proof_tier_required?: number;
  rotation_interval_blocks?: number;
  allow_tier_b_rollover?: boolean;
  state_replay_defense_window_blocks?: number;
  /* extensibility */
  [k: string]: any;
};

export enum ValidationResult {
  OK = 'ok',
  HARD_FAIL = 'hard_fail',
  SOFT_FAIL = 'soft_fail',
}

export type ValidationOutcome = {
  result: ValidationResult;
  field_tlv?: number;
  field_name?: string;
  reason?: string;
};

export type ReviewProposalResponse = {
  instance_id: string;
  lsp_peer_id: string;
  received_at_block: number;
  proposed: {
    funding_sats: number;
    n_participants: number;
    our_pidx: number;
    our_allocation_sats: number;
    all_allocations: ReviewProposalAllocation[];
    /** Basis-points (x100), e.g. 1250 = 12.50% */
    our_allocation_pct_x100: number;
  };
  advertised_policy_known: boolean;
  advertised_policy?: AdvertisedPolicy;
  user_prefs: ClientSigningPrefs;
  validation: ValidationOutcome;
};
