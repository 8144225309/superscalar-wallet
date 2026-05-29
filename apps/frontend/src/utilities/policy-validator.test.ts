import { validatePolicy, POLICY_TLV } from './policy-validator';
import { AdvertisedPolicy, ValidationResult } from '../types/review-proposal.type';
import { ClientSigningPrefs, DEFAULT_CLIENT_SIGNING_PREFS, ProofTier } from '../types/signing-prefs.type';

const baseAdvertised: AdvertisedPolicy = {
  htlc_min_sat: 1000,
  htlc_max_sat: 500_000,
  max_concurrent_htlcs_per_channel: 10,
  max_in_flight_msat_per_channel: 10_000_000,
  min_final_cltv_expiry_delta: 18,
  cltv_expiry_delta_forward: 18,
  min_capacity_per_join_sat: 10_000,
  max_capacity_per_join_sat: 1_000_000,
  proof_tier_required: ProofTier.INVOICE,
  rotation_interval_blocks: 144,
  allow_tier_b_rollover: true,
  state_replay_defense_window_blocks: 288,
};

describe('policy-validator', () => {
  it('returns OK when advertised policy meets all client thresholds', () => {
    const out = validatePolicy(baseAdvertised, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.OK);
  });

  it('rejects when htlc_min_sat exceeds client max', () => {
    const ad = { ...baseAdvertised, htlc_min_sat: 50_000 };
    const prefs: ClientSigningPrefs = { ...DEFAULT_CLIENT_SIGNING_PREFS, max_htlc_min_sat: 10_000 };
    const out = validatePolicy(ad, prefs);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('htlc_min_sat');
    expect(out.field_tlv).toBe(POLICY_TLV.htlc_min_sat);
  });

  it('rejects when htlc_max_sat is below client min', () => {
    const ad = { ...baseAdvertised, htlc_max_sat: 50_000 };
    const prefs: ClientSigningPrefs = { ...DEFAULT_CLIENT_SIGNING_PREFS, min_htlc_max_sat: 100_000 };
    const out = validatePolicy(ad, prefs);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('htlc_max_sat');
    expect(out.field_tlv).toBe(POLICY_TLV.htlc_max_sat);
  });

  it('rejects when max_concurrent_htlcs is below client min', () => {
    const ad = { ...baseAdvertised, max_concurrent_htlcs_per_channel: 2 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('max_concurrent_htlcs_per_channel');
  });

  it('rejects when max_in_flight_msat is below client min', () => {
    const ad = { ...baseAdvertised, max_in_flight_msat_per_channel: 100 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('max_in_flight_msat_per_channel');
  });

  it('rejects when min_final_cltv_expiry_delta exceeds client max', () => {
    const ad = { ...baseAdvertised, min_final_cltv_expiry_delta: 1000 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('min_final_cltv_expiry_delta');
  });

  it('rejects when cltv_expiry_delta_forward exceeds client max', () => {
    const ad = { ...baseAdvertised, cltv_expiry_delta_forward: 1000 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('cltv_expiry_delta_forward');
  });

  it('rejects when min_capacity_per_join_sat exceeds client max', () => {
    const ad = { ...baseAdvertised, min_capacity_per_join_sat: 10_000_000 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('min_capacity_per_join_sat');
  });

  it('rejects when max_capacity_per_join_sat is below client min', () => {
    const ad = { ...baseAdvertised, max_capacity_per_join_sat: 100 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('max_capacity_per_join_sat');
  });

  it('rejects when proof_tier_required is weaker than client max and strict mode on', () => {
    const ad = { ...baseAdvertised, proof_tier_required: ProofTier.NONE };
    const prefs = { ...DEFAULT_CLIENT_SIGNING_PREFS, require_strict_proof_tier: true, max_proof_tier: ProofTier.INVOICE };
    const out = validatePolicy(ad, prefs);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('proof_tier_required');
  });

  it('allows weaker proof_tier when strict mode is off', () => {
    const ad = { ...baseAdvertised, proof_tier_required: ProofTier.NONE };
    const prefs = { ...DEFAULT_CLIENT_SIGNING_PREFS, require_strict_proof_tier: false };
    const out = validatePolicy(ad, prefs);
    expect(out.result).toBe(ValidationResult.OK);
  });

  it('rejects when rotation_interval_blocks is below client min', () => {
    const ad = { ...baseAdvertised, rotation_interval_blocks: 10 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('rotation_interval_blocks');
  });

  it('rejects when allow_tier_b_rollover required but disabled by LSP', () => {
    const ad = { ...baseAdvertised, allow_tier_b_rollover: false };
    const prefs = { ...DEFAULT_CLIENT_SIGNING_PREFS, require_tier_b_rollover: true };
    const out = validatePolicy(ad, prefs);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('allow_tier_b_rollover');
  });

  it('rejects when state_replay_defense_window_blocks is below client min', () => {
    const ad = { ...baseAdvertised, state_replay_defense_window_blocks: 10 };
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('state_replay_defense_window_blocks');
  });

  it('ignores undefined advertised fields gracefully', () => {
    const ad: AdvertisedPolicy = {}; // nothing advertised
    const out = validatePolicy(ad, DEFAULT_CLIENT_SIGNING_PREFS);
    expect(out.result).toBe(ValidationResult.OK);
  });

  it('reports first failure when multiple fields fail (order matches plugin)', () => {
    const ad = {
      ...baseAdvertised,
      htlc_min_sat: 50_000,                 // 1st field
      max_concurrent_htlcs_per_channel: 1,  // 3rd field — should NOT be reported
    };
    const prefs: ClientSigningPrefs = { ...DEFAULT_CLIENT_SIGNING_PREFS, max_htlc_min_sat: 10_000 };
    const out = validatePolicy(ad, prefs);
    expect(out.result).toBe(ValidationResult.HARD_FAIL);
    expect(out.field_name).toBe('htlc_min_sat');
  });
});
