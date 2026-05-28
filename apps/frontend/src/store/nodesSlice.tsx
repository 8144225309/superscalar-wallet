import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NodeProfile, ProfileHealth } from '../types/node.type';
import { defaultNodesState } from './nodesSelectors';

const nodesSlice = createSlice({
  name: 'nodes',
  initialState: defaultNodesState,
  reducers: {
    setNodeProfiles(state, action: PayloadAction<{ profiles: NodeProfile[]; activeProfileId?: string | null; isConnected?: boolean }>) {
      state.profiles = action.payload.profiles || [];
      if (action.payload.activeProfileId !== undefined) {
        state.activeProfileId = action.payload.activeProfileId;
      }
      if (action.payload.isConnected !== undefined) {
        state.isConnected = action.payload.isConnected;
      }
      state.isLoading = false;
      state.error = null;
    },
    setActiveProfileId(state, action: PayloadAction<string | null>) {
      state.activeProfileId = action.payload;
    },
    setIsSwitching(state, action: PayloadAction<boolean>) {
      state.isSwitching = action.payload;
    },
    setIsDiscovering(state, action: PayloadAction<boolean>) {
      state.isDiscovering = action.payload;
    },
    setHasFactoryPlugin(state, action: PayloadAction<boolean>) {
      state.hasFactoryPlugin = action.payload;
    },
    setNodesError(state, action: PayloadAction<any>) {
      state.error = action.payload;
      state.isLoading = false;
    },
    setProfileHealth(state, action: PayloadAction<ProfileHealth[]>) {
      // Merge by profileId so a partial probe (e.g., one capped by
      // WALLET_HEALTH_PROBE_MAX, or a switch that only probed a subset)
      // doesn't clear previously-known dot colors. Latest probe wins per id;
      // profiles not in this update keep their last-known state -- so a
      // node that went red stays red until the next successful probe.
      const byId = new Map<string, ProfileHealth>();
      for (const h of state.profileHealth) byId.set(h.profileId, h);
      for (const h of action.payload) byId.set(h.profileId, h);
      state.profileHealth = Array.from(byId.values());
    },
    clearNodesStore() {
      return defaultNodesState;
    },
  },
});

export const {
  setNodeProfiles,
  setActiveProfileId,
  setIsSwitching,
  setIsDiscovering,
  setHasFactoryPlugin,
  setNodesError,
  setProfileHealth,
  clearNodesStore,
} = nodesSlice.actions;

export default nodesSlice.reducer;
