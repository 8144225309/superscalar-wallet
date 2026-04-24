import { FactoryAllocation } from '../types/factories.type';

export const BLOCKS_PER_DAY = 144;
export const BLOCKS_PER_HOUR = 6;

const DW_OVERHEAD_BLOCKS = 1008;
const BASE_CLTV_BUDGET_BLOCKS = 4032;
const MEDIAN_KICKOFF_FEE_SAT = 5000;

export const FACTORY_PLAN_DEFAULTS = {
  fundingSats: 1_000_000,
  nClients: 2,
  perClientCapacitySat: 450_000,
  lspReservePerLeafSat: 50_000,
  leafArity: 2,
  lifetimeBlocks: 4320,
  dyingPeriodBlocks: 288,
  epochCount: 8,
  ladderCadenceHours: 24,
  lspFeeSat: 0,
  lspFeePpm: 0,
};

export type FactoryPlanInputs = {
  fundingSats: number;
  nClients: number;
  perClientCapacitySat: number;
  lspReservePerLeafSat: number;
  leafArity: number;
  lifetimeBlocks: number;
  dyingPeriodBlocks: number;
  epochCount: number;
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

  const clientCltvBudgetBlocks = Math.max(
    0,
    BASE_CLTV_BUDGET_BLOCKS - DW_OVERHEAD_BLOCKS - inputs.dyingPeriodBlocks,
  );

  const lifetimeDays = inputs.lifetimeBlocks / BLOCKS_PER_DAY;
  const dyingPeriodDays = inputs.dyingPeriodBlocks / BLOCKS_PER_DAY;

  const feeRevenuePerFactorySat = inputs.nClients * inputs.lspFeeSat
    + Math.round((allocatedSum * inputs.lspFeePpm) / 1_000_000);
  const feeRevenuePerMonthSat = Math.round(feeRevenuePerFactorySat * (kickoffsPerMonth));

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

  if (clientCltvBudgetBlocks < 2016) {
    warnings.push({
      id: 'cltv_budget_insufficient',
      severity: 'warning',
      message: `Client HTLC CLTV budget would be ${clientCltvBudgetBlocks} blocks after factory overhead. Some routing paths (payments with long timeouts) will refuse to use these channels.`,
    });
  }

  if (inputs.epochCount > 32) {
    warnings.push({
      id: 'too_many_epochs',
      severity: 'warning',
      message: `${inputs.epochCount} epochs means up to ${inputs.epochCount} rotation ceremonies. Each one requires every client on its branch to come online and sign.`,
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
