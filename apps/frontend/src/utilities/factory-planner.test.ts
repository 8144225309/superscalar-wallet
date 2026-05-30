import {
  planFactory,
  blocksToDuration,
  LIFETIME_PRESETS,
  FACTORY_PLAN_DEFAULTS,
  FactoryPlanInputs,
  BLOCKS_PER_DAY,
  BLOCKS_PER_HOUR,
} from './factory-planner';

const baseInputs: FactoryPlanInputs = {
  fundingSats: 1_000_000,
  nClients: 32,
  perClientCapacitySat: 30_000,
  lspReservePerLeafSat: 1_000,
  leafArity: 1,
  leafChannelType: 'pseudo-spilman',
  psSubfactoryArity: 1,
  lifetimeBlocks: 4320,
  dyingPeriodBlocks: 432,
  epochCount: 4,
  blockEarlyCount: 144,
  ladderCadenceHours: 168,
  allocationsOverride: [],
  clientNodeIds: [],
};

describe('blocksToDuration', () => {
  it('formats sub-day intervals in hours', () => {
    expect(blocksToDuration(BLOCKS_PER_HOUR * 6)).toBe('~6 hours');
  });

  it('formats day-scale intervals with one decimal under 10 days', () => {
    expect(blocksToDuration(BLOCKS_PER_DAY * 3)).toBe('~3.0 days');
  });

  it('drops the decimal when >= 10 days', () => {
    expect(blocksToDuration(BLOCKS_PER_DAY * 30)).toBe('~30 days');
  });

  it('uses hours for 0-blocks too (avoids "~0.0 days")', () => {
    expect(blocksToDuration(0)).toMatch(/hours$/);
  });
});

describe('LIFETIME_PRESETS', () => {
  it('production preset is 30 active + 3 dying days', () => {
    expect(LIFETIME_PRESETS.production.lifetimeBlocks).toBe(BLOCKS_PER_DAY * 30);
    expect(LIFETIME_PRESETS.production.dyingPeriodBlocks).toBe(BLOCKS_PER_DAY * 3);
  });

  it('demo preset is 7 active + 2 dying days', () => {
    expect(LIFETIME_PRESETS.demo.lifetimeBlocks).toBe(BLOCKS_PER_DAY * 7);
    expect(LIFETIME_PRESETS.demo.dyingPeriodBlocks).toBe(BLOCKS_PER_DAY * 2);
  });
});

describe('planFactory — derived values', () => {
  it('nLeaves rounds up from nClients/leafArity', () => {
    expect(planFactory({ ...baseInputs, nClients: 32, leafArity: 1 }).derived.nLeaves).toBe(32);
    expect(planFactory({ ...baseInputs, nClients: 33, leafArity: 4 }).derived.nLeaves).toBe(9);
  });

  it('ladderFootprint = ceil(lifetime / cadence)', () => {
    const r = planFactory({ ...baseInputs, lifetimeBlocks: 1008, ladderCadenceHours: 168 });
    /* 168h × 6 blocks/h = 1008 cadence blocks; 1008/1008 = 1 */
    expect(r.derived.ladderFootprint).toBe(1);
    const r2 = planFactory({ ...baseInputs, lifetimeBlocks: 4320, ladderCadenceHours: 168 });
    /* 4320 / 1008 = 4.28… → 5 */
    expect(r2.derived.ladderFootprint).toBe(5);
  });

  it('kickoffsPerMonth = 720 / ladderCadenceHours', () => {
    const r = planFactory({ ...baseInputs, ladderCadenceHours: 24 });
    expect(r.derived.kickoffsPerMonth).toBeCloseTo(30, 3);
  });

  it('lspSingleFactoryCommitmentSat = nLeaves * lspReservePerLeafSat', () => {
    const r = planFactory({
      ...baseInputs,
      nClients: 32,
      leafArity: 1,
      lspReservePerLeafSat: 10_000,
    });
    expect(r.derived.lspSingleFactoryCommitmentSat).toBe(32 * 10_000);
  });

  it('lspLadderCommitmentSat scales by ladderFootprint', () => {
    const r = planFactory({
      ...baseInputs,
      lifetimeBlocks: 4320,
      ladderCadenceHours: 168,        // → ladderFootprint = 5
      lspReservePerLeafSat: 1_000,
      nClients: 32, leafArity: 1,     // → nLeaves = 32 → single = 32_000
    });
    expect(r.derived.lspLadderCommitmentSat).toBe(32_000 * 5);
  });

  it('expectedAllocationSum = funding - lspReserveTotal', () => {
    const r = planFactory({
      ...baseInputs,
      fundingSats: 1_000_000,
      nClients: 32, leafArity: 1,
      lspReservePerLeafSat: 1_000,
    });
    expect(r.derived.expectedAllocationSum).toBe(1_000_000 - 32_000);
  });

  it('lifetimeDays + dyingPeriodDays', () => {
    const r = planFactory({
      ...baseInputs,
      lifetimeBlocks: BLOCKS_PER_DAY * 30,
      dyingPeriodBlocks: BLOCKS_PER_DAY * 3,
    });
    expect(r.derived.lifetimeDays).toBe(30);
    expect(r.derived.dyingPeriodDays).toBe(3);
  });
});

describe('planFactory — warnings', () => {
  function warningIds(inputs: FactoryPlanInputs): string[] {
    return planFactory(inputs).warnings.map(w => w.id);
  }

  it('errors when nClients is not a multiple of leafArity', () => {
    expect(warningIds({ ...baseInputs, nClients: 33, leafArity: 2 }))
      .toContain('clients_not_multiple_of_arity');
  });

  it('errors when cadence > lifetime', () => {
    expect(warningIds({
      ...baseInputs,
      lifetimeBlocks: 100,
      ladderCadenceHours: 200,  // 1200 cadence blocks > 100 lifetime
    })).toContain('cadence_exceeds_lifetime');
  });

  it('errors when allocations override sum doesnt match expected', () => {
    expect(warningIds({
      ...baseInputs,
      fundingSats: 1_000_000,
      lspReservePerLeafSat: 0,
      allocationsOverride: [{ node_id: 'a', capacity_sat: 500_000 }],
    })).toContain('allocation_sum_mismatch');
  });

  it('warns when dying period < 24h', () => {
    expect(warningIds({ ...baseInputs, dyingPeriodBlocks: 100 }))
      .toContain('dying_period_too_short');
  });

  it('warns when epochCount above CLTV cliff (>13)', () => {
    expect(warningIds({ ...baseInputs, epochCount: 20 }))
      .toContain('too_many_epochs');
  });

  it('info hint when fewer than 4 epochs', () => {
    expect(warningIds({ ...baseInputs, epochCount: 2 }))
      .toContain('too_few_epochs');
  });

  it('errors when wide-leaf used with ln-penalty leaf type', () => {
    expect(warningIds({
      ...baseInputs,
      leafChannelType: 'ln-penalty',
      psSubfactoryArity: 2,
    })).toContain('ps_subfactory_requires_ps_leaves');
  });

  it('info when ln-penalty leaves selected', () => {
    expect(warningIds({ ...baseInputs, leafChannelType: 'ln-penalty', psSubfactoryArity: 1 }))
      .toContain('ln_penalty_leaves');
  });

  it('warns when no LSP reserve per leaf', () => {
    expect(warningIds({ ...baseInputs, lspReservePerLeafSat: 0 }))
      .toContain('no_reserve');
  });

  it('warns when pubkey count mismatches client count', () => {
    expect(warningIds({
      ...baseInputs,
      nClients: 32,
      clientNodeIds: ['a', 'b', 'c'],
    })).toContain('pubkey_count_mismatch');
  });
});

describe('planFactory — canSubmit', () => {
  it('false when any error-severity warning exists', () => {
    const r = planFactory({ ...baseInputs, nClients: 33, leafArity: 2 });
    expect(r.canSubmit).toBe(false);
  });

  it('false when fundingSats = 0', () => {
    expect(planFactory({ ...baseInputs, fundingSats: 0 }).canSubmit).toBe(false);
  });

  it('false when nClients = 0', () => {
    expect(planFactory({ ...baseInputs, nClients: 0 }).canSubmit).toBe(false);
  });

  it('true on a clean baseline plan', () => {
    expect(planFactory(baseInputs).canSubmit).toBe(true);
  });
});

describe('FACTORY_PLAN_DEFAULTS', () => {
  it('matches design recommendations (production preset)', () => {
    expect(FACTORY_PLAN_DEFAULTS.lifetimeBlocks).toBe(LIFETIME_PRESETS.production.lifetimeBlocks);
    expect(FACTORY_PLAN_DEFAULTS.dyingPeriodBlocks).toBe(LIFETIME_PRESETS.production.dyingPeriodBlocks);
  });
});
