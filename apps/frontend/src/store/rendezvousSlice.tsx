import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  BrowseCacheEntry,
  RendezvousSettings,
  Vouch,
  VouchTier,
} from '../types/rendezvous.type';
import { defaultRendezvousState } from './rendezvousSelectors';

const rendezvousSlice = createSlice({
  name: 'rendezvous',
  initialState: defaultRendezvousState,
  reducers: {
    setSettingsLoading(state, action: PayloadAction<boolean>) {
      state.settingsLoading = action.payload;
      if (action.payload) state.settingsError = undefined;
    },
    setSettings(state, action: PayloadAction<RendezvousSettings>) {
      state.settings = action.payload;
      state.settingsLoading = false;
      state.settingsError = undefined;
    },
    setSettingsError(state, action: PayloadAction<string>) {
      state.settingsError = action.payload;
      state.settingsLoading = false;
    },
    setVouchListLoading(state, action: PayloadAction<boolean>) {
      state.vouchList.isLoading = action.payload;
    },
    setVouchList(
      state,
      action: PayloadAction<{
        vouches: Vouch[];
        byCoordinator: Record<string, { tier: Record<VouchTier, number>; total: number }>;
        errors: Record<string, string>;
      }>,
    ) {
      state.vouchList = {
        isLoading: false,
        vouches: action.payload.vouches,
        byCoordinator: action.payload.byCoordinator,
        errors: action.payload.errors,
        lastFetchedAt: Date.now(),
      };
    },
    setBrowseCacheEntry(
      state,
      action: PayloadAction<{ lnNodeId: string; entry: BrowseCacheEntry }>,
    ) {
      state.browseCache[action.payload.lnNodeId] = action.payload.entry;
    },
    clearBrowseCache(state) {
      state.browseCache = {};
    },
    clearRendezvousStore() {
      return defaultRendezvousState;
    },
  },
});

export const {
  setSettingsLoading,
  setSettings,
  setSettingsError,
  setVouchListLoading,
  setVouchList,
  setBrowseCacheEntry,
  clearBrowseCache,
  clearRendezvousStore,
} = rendezvousSlice.actions;

export default rendezvousSlice.reducer;
