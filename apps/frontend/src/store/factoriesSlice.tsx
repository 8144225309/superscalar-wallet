/**
 * Factories Slice — Redux state for the SuperScalar factories surface.
 *
 * What it manages
 *   The factoryList (every factory this node knows about, polled +
 *   pushed via factoryEvents), selectedFactory (the one open in
 *   FactoryDetail), and actionStatus (one of Idle/Pending/Success/
 *   Error — drives StatusAlert in mutating action flows).
 *
 * Lazy injection
 *   Not in the base appStore — useInjectReducer adds it the first
 *   time FactoriesHome mounts. See [[use-injectreducer]].
 *
 * Reducer surface
 *   setFactoryList, setSelectedFactory, setActionStatus, plus
 *   factoryUpserted (used by useFactoryEventStream to splice in
 *   a single updated factory without re-fetching the list).
 *
 * Selectors
 *   See [[factoriesSelectors]] for memoized accessors and counts.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Factory, FactoriesState } from '../types/factories.type';
import { defaultFactoriesState } from './factoriesSelectors';

const factoriesSlice = createSlice({
  name: 'factories',
  initialState: defaultFactoriesState,
  reducers: {
    setFactoryList(state, action: PayloadAction<{ factories?: Factory[]; error?: any; isLoading?: boolean }>) {
      if (action.payload.error) {
        state.factoryList = { ...state.factoryList, error: action.payload.error, isLoading: false };
        return;
      }
      state.factoryList = {
        isLoading: false,
        factories: action.payload.factories || [],
        error: undefined,
      };
    },
    setFactoryListLoading(state, action: PayloadAction<boolean>) {
      state.factoryList.isLoading = action.payload;
    },
    setSelectedFactory(state, action: PayloadAction<Factory | null>) {
      state.selectedFactory = action.payload;
    },
    setActionStatus(state, action: PayloadAction<FactoriesState['actionStatus']>) {
      state.actionStatus = action.payload;
    },
    clearActionStatus(state) {
      state.actionStatus = defaultFactoriesState.actionStatus;
    },
    clearFactoriesStore() {
      return defaultFactoriesState;
    },
  },
});

export const {
  setFactoryList,
  setFactoryListLoading,
  setSelectedFactory,
  setActionStatus,
  clearActionStatus,
  clearFactoriesStore,
} = factoriesSlice.actions;

export default factoriesSlice.reducer;
