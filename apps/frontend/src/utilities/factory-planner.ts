import { FactoryAllocation } from '../types/factories.type';

export const BLOCKS_PER_DAY = 144;
export const BLOCKS_PER_HOUR = 6;

const NSEQUENCE_STEP_BLOCKS = 144;
const BASE_CLTV_BUDGET_BLOCKS = 4032;
const MEDIAN_KICKOFF_FEE_SAT = 5000;
const CLTV_WARN_THRESHOLD = 2016;
const EPOCH_CLIFF_THRESHOLD = 13;

export const FACTORY_PLAN_DEFAULTS = {
  fundingSats: 1_000_000,
  nClients: 2,
  perClientCapacitySat: 450_000,
  lspReservePerLeafSat: 50_000,
  leafArity: 2,
  leafChannelType: 'pseudo-spilman' as 'pseudo-spilman' | 'ln-penalty',
  lifetimeBlocks: 4320,
  dyingPeriodBlocks: 288,
  epochCount: 6,
  blockEarlyCount: 144,
  ladderCadenceHours: 24,
  lspFeeSat: 0,
  lspFeePpm: 0,
  autoHostNext: true,
  autoFinalizeOnDying: true,
  autoRotatePeriodically: false,
  autoAcceptJoiners: false,
  allowBolt12: true,
  allowAmp: false,
  htlcMinSat: 1,
  htlcMaxSat: 0,
  advertiseOnNostr: false,
};

export type FactoryPlanInputs = {
  fundingSats: number;
  nClients: number;
  perClientCapacitySat: number;
  lspReservePerLeafSat: number;
  leafArity: number;
  leafChannelType: 'pseudo-spilman' | 'ln-penalty';
  lifetimeBlocks: number;
  dyingPeriodBlocks: number;
  epochCount: number;
  blockEarlyCount: number;
  ladderCadenceHours: number;
  lspFeeSat: number;
  lspFeePpm: number;
  allocationsOverride: FactoryAllocation[];
  clientNodeIds: string[];
};

export type FactoryPlanDerived = {
  nLeaves: number;
  ladderFootprint: number;
  avgWaitHours: number;
  kickoffsPerMonth: number;
  approxOnchainCostPerMonthSat: number;
  lspSingleFactoryCommitmentSat: number;
  lspLadderCommitmentSat: number;
  clientCltvBudgetBlocks: number;
  dwOverheadBlocks: number;
  allocatedSum: number;
  expectedAllocationSum: number;
  lifetimeDays: number;
  dyingPeriodDays: number;
  cadenceBlocks: number;
  feeRevenuePerFactorySat: number;
  feeRevenuePerMonthSat: number;
};

export type FactoryPlanWarning = {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type FactoryPlan = {
  derived: FactoryPlanDerived;
  warnings: FactoryPlanWarning[];
  canSubmit: boolean;
};

export function planFactory(inputs: FactoryPlanInputs): FactoryPlan {
  const warnings: FactoryPlanWarning[] = [];

  const leafArity = Math.max(1, inputs.leafArity);
  const nLeaves = Math.max(1, Math.ceil(inputs.nClients / leafArity));
  const lspReserveTotal = nLeaves * inputs.lspReservePerLeafSat;
  const expectedAllocationSum = Math.max(
    0,
    inputs.fundingSats - lspReserveTotal - inputs.lspFeeSat,
  );

  const effectiveAllocations = inputs.allocationsOverride.length > 0
    ? inputs.allocationsOverride
    : Array.from({ length: inputs.nClients }, (_, i) => ({
      node_id: inputs.clientNodeIds[i] || '',
      capacity_sat: inputs.perClientCapacitySat,
    }));
  const allocatedSum = effectiveAllocations.reduce((sum, a) => sum + (a.capacity_sat || 0), 0);

  const cadenceBlocks = Math.max(1, Math.round(inputs.ladderCadenceHours * BLOCKS_PER_HOUR));
  const ladderFootprint = Math.max(1, Math.ceil(inputs.lifetimeBlocks / cadenceBlocks));
  const avgWaitHours = inputs.ladderCadenceHours / 2;
  const kickoffsPerMonth = (30 * 24) / inputs.ladderCadenceHours;
  const approxOnchainCostPerMonthSat = Math.round(kickoffsPerMonth * MEDIAN_KICKOFF_FEE_SAT);

  const lspSingleFactoryCommitmentSat = lspReserveTotal + inputs.lspFeeSat;
  const lspLadderCommitmentSat = lspSingleFactoryCommitmentSat * ladderFootprint;

  const dwOverheadBlocks = inputs.epochCount * NSEQUENCE_STEP_BLOCKS;
  const clientCltvBudgetBlocks = Math.max(
    0,
    BASE_CLTV_BUDGET_BLOCKS - dwOverheadBlocks - inputs.dyingPeriodBlocks - inputs.blockEarlyCount,
  );

  const lifetimeDays = inputs.lifetimeBlocks / BLOCKS_PER_DAY;
  const dyingPeriodDays = inputs.dyingPeriodBlocks / BLOCKS_PER_DAY;

  const feeRevenuePerFactorySat = inputs.nClients * inputs.lspFeeSat
    + Math.round((allocatedSum * inputs.lspFeePpm) / 1_000_000);
  const feeRevenuePerMonthSat = Math.round(feeRevenuePerFactorySat * kickoffsPerMonth);

  if (inputs.nClients % leafArity !== 0) {
    warnings.push({
      id: 'clients_not_multiple_of_arity',
      severity: 'error',
      message: `Client count (${inputs.nClients}) must be a multiple of leaf arity (${leafArity}). Add or remove clients, or change arity.`,
    });
  }

  if (inputs.allocationsOverride.length > 0 && allocatedSum !== expectedAllocationSum) {
    warnings.push({
      id: 'allocation_sum_mismatch',
      severity: 'error',
      message: `Allocations sum to ${allocatedSum.toLocaleString()} sat but ${expectedAllocationSum.toLocaleString()} sat is available after LSP reserve and fees. Adjust allocations or funding amount.`,
    });
  }

  if (cadenceBlocks > inputs.lifetimeBlocks) {
    warnings.push({
      id: 'cadence_exceeds_lifetime',
      severity: 'error',
      message: 'Ladder cadence is longer than the factory active period — there will be gaps with no active factory. Shorten cadence or lengthen lifetime.',
    });
  }

  if (inputs.dyingPeriodBlocks < BLOCKS_PER_DAY) {
    warnings.push({
      id: 'dying_period_too_short',
      severity: 'warning',
      message: `Dying period is under 24h (${inputs.dyingPeriodBlocks} blocks). Clients on mobile wallets may miss the migration window and be forced to exit onchain.`,
    });
  }

  if (ladderFootprint > 30) {
    warnings.push({
      id: 'ladder_too_many',
      severity: 'warning',
      message: `Ladder will maintain ${ladderFootprint} concurrent factories. Each one is an onchain kickoff — monthly onchain cost scales linearly.`,
    });
  }

  if (clientCltvBudgetBlocks < CLTV_WARN_THRESHOLD) {
    warnings.push({
      id: 'cltv_budget_insufficient',
      severity: 'warning',
      message: `Client HTLC CLTV budget would be ${clientCltvBudgetBlocks} blocks after factory overhead. Some routing paths (payments with long timeouts) will refuse to use these channels.`,
    });
  }

  if (inputs.epochCount > EPOCH_CLIFF_THRESHOLD) {
    warnings.push({
      id: 'too_many_epochs',
      severity: 'warning',
      message: `${inputs.epochCount} epochs at ${NSEQUENCE_STEP_BLOCKS}-block step burns ${dwOverheadBlocks} blocks of CLTV budget. The SuperScalar reference design uses 4 — pseudo-Spilman leaves mean payments don't consume epochs, so most operators don't need many.`,
    });
  }

  if (inputs.epochCount < 4) {
    warnings.push({
      id: 'too_few_epochs',
      severity: 'info',
      message: 'Fewer than 4 epochs leaves no buffer for retry attempts or unexpected reallocations. The reference design uses 4.',
    });
  }

  if (inputs.blockEarlyCount > inputs.dyingPeriodBlocks) {
    warnings.push({
      id: 'block_early_exceeds_dying',
      severity: 'warning',
      message: `Block-early count (${inputs.blockEarlyCount}) exceeds dying period (${inputs.dyingPeriodBlocks}). Plugin will trigger early exits before clients have a chance to migrate cooperatively.`,
    });
  }

  if (inputs.leafChannelType === 'ln-penalty') {
    warnings.push({
      id: 'ln_penalty_leaves',
      severity: 'info',
      message: 'LN-Penalty leaves require clients to maintain watchtower-grade liveness. Pseudo-Spilman is the design\'s preferred leaf type for mobile/no-coiner clients.',
    });
  }

  if (lspLadderCommitmentSat > 10_000_000) {
    warnings.push({
      id: 'large_commitment',
      severity: 'info',
      message: `Total LSP commitment across the ladder is ${lspLadderCommitmentSat.toLocaleString()} sat. Plan for fee-bumping reserves on top of this.`,
    });
  }

  if (inputs.lspReservePerLeafSat === 0) {
    warnings.push({
      id: 'no_reserve',
      severity: 'warning',
      message: 'No LSP reserve per leaf means you cannot dynamically allocate inbound liquidity to clients after the factory is open.',
    });
  }

  if (inputs.clientNodeIds.length > 0 && inputs.clientNodeIds.length !== inputs.nClients) {
    warnings.push({
      id: 'pubkey_count_mismatch',
      severity: 'warning',
      message: `Client count is ${inputs.nClients} but ${inputs.clientNodeIds.length} pubkey(s) provided. Missing slots will be filled by the plugin at ceremony time.`,
    });
  }

  const canSubmit = !warnings.some(w => w.severity === 'error') && inputs.fundingSats > 0 && inputs.nClients > 0;

  return {
    derived: {
      nLeaves,
      ladderFootprint,
      avgWaitHours,
      kickoffsPerMonth,
      approxOnchainCostPerMonthSat,
      lspSingleFactoryCommitmentSat,
      lspLadderCommitmentSat,
      clientCltvBudgetBlocks,
      dwOverheadBlocks,
      allocatedSum,
      expectedAllocationSum,
      lifetimeDays,
      dyingPeriodDays,
      cadenceBlocks,
      feeRevenuePerFactorySat,
      feeRevenuePerMonthSat,
    },
    warnings,
    canSubmit,
  };
}

export function blocksToDuration(blocks: number): string {
  const days = blocks / BLOCKS_PER_DAY;
  if (days >= 1) return `~${days.toFixed(days >= 10 ? 0 : 1)} days`;
  const hours = blocks / BLOCKS_PER_HOUR;
  return `~${hours.toFixed(0)} hours`;
}
