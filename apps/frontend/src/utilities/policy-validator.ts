/**
 * TS mirror of the plugin's client-side policy validator.
 *
 * The plugin's C validator (factory-review-proposal RPC) is the
 * authoritative source. This TS mirror exists for:
 *
 *   1. Pre-flight UX — show a user-friendly verdict in the wallet UI
 *      before they click Approve / Refuse, without round-tripping the
 *      plugin if the validator already ran.
 *   2. External wallets — third-party wallets that don't have the
 *      plugin in process need a way to validate FACTORY_POLICY_V1
 *      §4.0.2 joiner_enforceable_hard fields. Importing this module
 *      gives them a turnkey check.
 *   3. Unit tests — the wallet's modal can be tested without a live
 *      plugin by feeding constructed AdvertisedPolicy + ClientSigningPrefs.
 *
 * If the plugin and this mirror disagree, the plugin wins (it's the
 * one actually gating the signing decision). This mirror documents
 * the contract in TS for the UI layer.
 *
 * Canonical source: superscalar-cln/src/factory_policy.h and
 * docs/FACTORY_POLICY_V1.md (§4.0.2).
 */

import {
  AdvertisedPolicy,
  ValidationOutcome,
  ValidationResult,
} from '../types/review-proposal.type';
import {
  ClientSigningPrefs,
  ProofTier,
} from '../types/signing-prefs.type';

/* TLV codes per FACTORY_POLICY_V1 §4.0.2 joiner_enforceable_hard
 * field table. Used in ValidationOutcome.field_tlv. */
export const POLICY_TLV = {
  htlc_min_sat: 1,
  htlc_max_sat: 2,
  max_concurrent_htlcs_per_channel: 3,
  max_in_flight_msat_per_channel: 4,
  min_final_cltv_expiry_delta: 5,
  cltv_expiry_delta_forward: 6,
  min_capacity_per_join_sat: 7,
  max_capacity_per_join_sat: 8,
  proof_tier_required: 9,
  rotation_interval_blocks: 10,
  allow_tier_b_rollover: 11,
  state_replay_defense_window_blocks: 12,
} as const;

type CheckResult =
  | { ok: true }
  | { ok: false; reason: string; field: keyof typeof POLICY_TLV };

function check(advertised: AdvertisedPolicy, prefs: ClientSigningPrefs): CheckResult {
  /* Order mirrors the C validator so field_tlv / field_name remain
   * consistent if the validator returns at first failure. */

  if (
    advertised.htlc_min_sat !== undefined &&
    advertised.htlc_min_sat > prefs.max_htlc_min_sat
  ) {
    return {
      ok: false,
      field: 'htlc_min_sat',
      reason: `LSP htlc_min_sat=${advertised.htlc_min_sat} exceeds your max ${prefs.max_htlc_min_sat}`,
    };
  }

  if (
    advertised.htlc_max_sat !== undefined &&
    advertised.htlc_max_sat < prefs.min_htlc_max_sat
  ) {
    return {
      ok: false,
      field: 'htlc_max_sat',
      reason: `LSP htlc_max_sat=${advertised.htlc_max_sat} is below your min ${prefs.min_htlc_max_sat}`,
    };
  }

  if (
    advertised.max_concurrent_htlcs_per_channel !== undefined &&
    advertised.max_concurrent_htlcs_per_channel < prefs.min_max_concurrent_htlcs
  ) {
    return {
      ok: false,
      field: 'max_concurrent_htlcs_per_channel',
      reason: `LSP max_concurrent_htlcs=${advertised.max_concurrent_htlcs_per_channel} is below your min ${prefs.min_max_concurrent_htlcs}`,
    };
  }

  if (
    advertised.max_in_flight_msat_per_channel !== undefined &&
    advertised.max_in_flight_msat_per_channel < prefs.min_max_in_flight_msat
  ) {
    return {
      ok: false,
      field: 'max_in_flight_msat_per_channel',
      reason: `LSP max_in_flight_msat=${advertised.max_in_flight_msat_per_channel} is below your min ${prefs.min_max_in_flight_msat}`,
    };
  }

  if (
    advertised.min_final_cltv_expiry_delta !== undefined &&
    advertised.min_final_cltv_expiry_delta > prefs.max_min_final_cltv_delta
  ) {
    return {
      ok: false,
      field: 'min_final_cltv_expiry_delta',
      reason: `LSP min_final_cltv_expiry_delta=${advertised.min_final_cltv_expiry_delta} exceeds your max ${prefs.max_min_final_cltv_delta}`,
    };
  }

  if (
    advertised.cltv_expiry_delta_forward !== undefined &&
    advertised.cltv_expiry_delta_forward > prefs.max_cltv_delta_forward
  ) {
    return {
      ok: false,
      field: 'cltv_expiry_delta_forward',
      reason: `LSP cltv_expiry_delta_forward=${advertised.cltv_expiry_delta_forward} exceeds your max ${prefs.max_cltv_delta_forward}`,
    };
  }

  if (
    advertised.min_capacity_per_join_sat !== undefined &&
    advertised.min_capacity_per_join_sat > prefs.max_min_capacity_per_join_sat
  ) {
    return {
      ok: false,
      field: 'min_capacity_per_join_sat',
      reason: `LSP min_capacity_per_join_sat=${advertised.min_capacity_per_join_sat} exceeds your max ${prefs.max_min_capacity_per_join_sat}`,
    };
  }

  if (
    advertised.max_capacity_per_join_sat !== undefined &&
    advertised.max_capacity_per_join_sat < prefs.min_max_capacity_per_join_sat
  ) {
    return {
      ok: false,
      field: 'max_capacity_per_join_sat',
      reason: `LSP max_capacity_per_join_sat=${advertised.max_capacity_per_join_sat} is below your min ${prefs.min_max_capacity_per_join_sat}`,
    };
  }

  if (
    prefs.require_strict_proof_tier &&
    advertised.proof_tier_required !== undefined &&
    (advertised.proof_tier_required as ProofTier) > prefs.max_proof_tier
  ) {
    return {
      ok: false,
      field: 'proof_tier_required',
      reason: `LSP proof_tier_required=${ProofTier[advertised.proof_tier_required as ProofTier]} is weaker than your max ${ProofTier[prefs.max_proof_tier]}`,
    };
  }

  if (
    advertised.rotation_interval_blocks !== undefined &&
    advertised.rotation_interval_blocks < prefs.min_rotation_interval_blocks
  ) {
    return {
      ok: false,
      field: 'rotation_interval_blocks',
      reason: `LSP rotation_interval=${advertised.rotation_interval_blocks} blocks is below your min ${prefs.min_rotation_interval_blocks}`,
    };
  }

  if (
    prefs.require_tier_b_rollover &&
    advertised.allow_tier_b_rollover !== undefined &&
    !advertised.allow_tier_b_rollover
  ) {
    return {
      ok: false,
      field: 'allow_tier_b_rollover',
      reason: 'You require Tier-B rollover; LSP does not allow it',
    };
  }

  if (
    advertised.state_replay_defense_window_blocks !== undefined &&
    advertised.state_replay_defense_window_blocks < prefs.min_state_replay_defense_window_blocks
  ) {
    return {
      ok: false,
      field: 'state_replay_defense_window_blocks',
      reason: `LSP state_replay_defense_window=${advertised.state_replay_defense_window_blocks} blocks is below your min ${prefs.min_state_replay_defense_window_blocks}`,
    };
  }

  return { ok: true };
}

/**
 * Validate an advertised LSP policy against a user's client signing
 * prefs, mirroring the plugin's joiner_enforceable_hard check.
 *
 * Returns ValidationOutcome compatible with the shape the plugin emits
 * via factory-review-proposal — so UI code can treat the local result
 * and the plugin result identically.
 */
export function validatePolicy(
  advertised: AdvertisedPolicy,
  prefs: ClientSigningPrefs,
): ValidationOutcome {
  const r = check(advertised, prefs);
  if (r.ok) return { result: ValidationResult.OK };
  return {
    result: ValidationResult.HARD_FAIL,
    field_tlv: POLICY_TLV[r.field],
    field_name: r.field,
    reason: r.reason,
  };
}
