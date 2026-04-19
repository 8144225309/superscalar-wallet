import { createSelector } from '@reduxjs/toolkit';
import {
  RendezvousState,
  Vouch,
  VouchTier,
  CoordinatorNetwork,
  CoordinatorEntry,
} from '../types/rendezvous.type';

const TIER_RANK: Record<VouchTier, number> = { channel: 0, utxo: 1, peer: 2 };

export const defaultRendezvousState: RendezvousState = {
  settings: null,
  settingsLoading: false,
  vouchList: {
    isLoading: false,
    vouches: [],
    byCoordinator: {},
    errors: {},
  },
  browseCache: {},
};

const selectRendezvousState = (state: { rendezvous?: RendezvousState }) =>
  state.rendezvous || defaultRendezvousState;

export const selectRendezvousSettings = createSelector(
  selectRendezvousState,
  (s) => s.settings,
);

export const selectSettingsLoading = createSelector(
  selectRendezvousState,
  (s) => s.settingsLoading,
);

export const selectSettingsError = createSelector(
  selectRendezvousState,
  (s) => s.settingsError,
);

export const selectVouchList = createSelector(
  selectRendezvousState,
  (s) => s.vouchList,
);

export const selectVouches = createSelector(
  selectVouchList,
  (vl) => vl.vouches,
);

export const selectVouchesLoading = createSelector(
  selectVouchList,
  (vl) => vl.isLoading,
);

export const selectVouchErrors = createSelector(
  selectVouchList,
  (vl) => vl.errors,
);

export const selectVouchCounts = createSelector(
  selectVouches,
  (vouches) => {
    const counts: Record<VouchTier, number> = { channel: 0, utxo: 0, peer: 0 };
    for (const v of vouches) counts[v.tier]++;
    return counts;
  },
);

/** Active (enabled) coordinators for a given network. */
export const makeSelectActiveCoordinators = (network: CoordinatorNetwork) =>
  createSelector(selectRendezvousSettings, (settings): CoordinatorEntry[] =>
    settings ? settings.coordinators[network].filter(c => c.enabled) : [],
  );

export const selectEnabledRelays = createSelector(
  selectRendezvousSettings,
  (settings) => (settings ? settings.relays.filter(r => r.enabled).map(r => r.url) : []),
);

/**
 * Vouches sorted by tier strength (channel > utxo > peer), then by `verified_at`
 * descending so fresher attestations come first inside a tier.
 */
export const selectMergedVouchList = createSelector(
  selectVouches,
  (vouches) =>
    [...vouches].sort((a, b) => {
      const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
      if (t !== 0) return t;
      return b.verified_at - a.verified_at;
    }),
);

export const selectBrowseCacheFor = (lnNodeId: string) =>
  createSelector(selectRendezvousState, (s) => s.browseCache[lnNodeId]);
