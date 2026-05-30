/**
 * CLN Slice — Redux state for CLN-domain UI surfaces.
 *
 * What it manages
 *   The paginated offers list (BOLT12), lightning transactions list
 *   (invoice + sendpay union, see cln-sql.listLightningTransactionsSQL),
 *   BTC on-chain transactions list (listBTCTransactionsSQL), and the
 *   current on-chain feeRate (estimatesmartfee).
 *
 *   Each list slice carries `isLoading` + `page` + `hasMore` for the
 *   infinite-scroll pattern. Setting page=current+1 advances the
 *   pagination cursor and the next setListX call appends rather
 *   than replaces.
 *
 * Lazy injection
 *   Not in the base appStore — useInjectReducer adds it when the user
 *   navigates into /cln/* routes.
 *
 * Selectors
 *   See [[clnSelectors]] for memoized accessors.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ListOffers, NodeFeeRate, ListLightningTransactions, ListBitcoinTransactions } from '../types/cln.type';
import { defaultCLNState } from './clnSelectors';

const clnSlice = createSlice({
  name: 'cln',
  initialState: defaultCLNState,
  reducers: {
    setListLightningTransactions(state, action: PayloadAction<ListLightningTransactions>) {
      if (action.payload.error) {
        state.listLightningTransactions = { ...state.listLightningTransactions, error: action.payload.error };
        return;
      }
      if (action.payload.page === 1) {
        // Replace array for page 1
        state.listLightningTransactions = {
          ...state.listLightningTransactions,
          ...action.payload,
        };
      } else {
        // Append to existing array for page > 1
        state.listLightningTransactions = {
          ...state.listLightningTransactions,
          ...action.payload,
          clnTransactions: [
            ...state.listLightningTransactions.clnTransactions,
            ...action.payload.clnTransactions,
          ],
        };
      }
    },
    setListLightningTransactionsLoading(state, action: PayloadAction<boolean>) {
      state.listLightningTransactions.isLoading = action.payload;
    },
    resetListLightningTransactions(state) {
      state.listLightningTransactions = defaultCLNState.listLightningTransactions;
    },
    setListOffers(state, action: PayloadAction<ListOffers>) {
      if (action.payload.error) {
        state.listOffers = { ...state.listOffers, error: action.payload.error };
        return;
      }
      
      if (action.payload.page === 1) {
        // Replace array for page 1
        state.listOffers = {
          ...state.listOffers,
          ...action.payload,
        };
      } else {
        // Append to existing array for page > 1
        state.listOffers = {
          ...state.listOffers,
          ...action.payload,
          offers: [
            ...state.listOffers.offers,
            ...action.payload.offers,
          ],
        };
      }
    },
    setListOffersLoading(state, action: PayloadAction<boolean>) {
      state.listOffers.isLoading = action.payload;
    },
    resetListOffers(state) {
      state.listOffers = defaultCLNState.listOffers;
    },
    setListBitcoinTransactions(state, action: PayloadAction<ListBitcoinTransactions>) {
      if (action.payload.error) {
        state.listBitcoinTransactions = { ...state.listBitcoinTransactions, error: action.payload.error };
        return;
      }
      
      if (action.payload.page === 1) {
        // Replace array for page 1
        state.listBitcoinTransactions = {
          ...state.listBitcoinTransactions,
          ...action.payload,
        };
      } else {
        // Append to existing array for page > 1
        state.listBitcoinTransactions = {
          ...state.listBitcoinTransactions,
          ...action.payload,
          btcTransactions: [
            ...state.listBitcoinTransactions.btcTransactions,
            ...action.payload.btcTransactions,
          ],
        };
      }
    },
    setListBitcoinTransactionsLoading(state, action: PayloadAction<boolean>) {
      state.listBitcoinTransactions.isLoading = action.payload;
    },
    resetListBitcoinTransactions(state) {
      state.listBitcoinTransactions = defaultCLNState.listBitcoinTransactions;
    },
    setFeeRate(state, action: PayloadAction<NodeFeeRate>) {
      if (action.payload.error) {
        state.feeRate = { ...state.feeRate, error: action.payload.error };
        return;
      }
      state.feeRate = action.payload;
    },
    clearCLNStore() {
      return defaultCLNState;
    }
  }
});

export const {
  setListLightningTransactionsLoading,
  setListLightningTransactions,
  resetListLightningTransactions,
  setListOffersLoading,
  setListOffers,
  resetListOffers,
  setListBitcoinTransactionsLoading,
  setListBitcoinTransactions,
  resetListBitcoinTransactions,
  setFeeRate,
  clearCLNStore
} = clnSlice.actions;

export default clnSlice.reducer;
