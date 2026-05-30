/**
 * CLN Selectors — memoized accessors for the `cln` slice.
 *
 * What it provides
 *   Accessors for the CLN-domain UI surfaces: paginated offers list,
 *   lightning transactions list, BTC transactions list, current
 *   on-chain feeRate. Each list slice carries `isLoading` + `page` +
 *   `hasMore` to support infinite-scroll patterns; the BTCWallet and
 *   CLNWallet pages call setListLightningTransactions etc. with
 *   page=current+1 to advance.
 *
 * `defaultCLNState`
 *   Used by tests and as the fallback when the cln slice has not yet
 *   been injected. cln is lazily injected via useInjectReducer when
 *   the user navigates into a CLN route.
 *
 * Public API
 *   Each selector is a named export. Components import selectors
 *   directly.
 */
import { createSelector } from '@reduxjs/toolkit';
import { CLNState } from '../types/cln.type';

export const defaultCLNState: CLNState = {
  listOffers: { isLoading: true, page: 0, hasMore: true, offers: [] },
  listLightningTransactions: { isLoading: true, page: 0, hasMore: true, clnTransactions: [] },
  listBitcoinTransactions: { isLoading: true, page: 0, hasMore: true, btcTransactions: [] },
  feeRate: { isLoading: true },
};

const selectCLNState = (state: { cln: CLNState }) => state.cln || defaultCLNState;

export const selectListOffers = createSelector(
  selectCLNState,
  (cln) => cln.listOffers
);

export const selectListLightningTransactions = createSelector(
  selectCLNState,
  (cln) => cln.listLightningTransactions
);

export const selectListBitcoinTransactions = createSelector(
  selectCLNState,
  (cln) => cln.listBitcoinTransactions
);

export const selectFeeRate = createSelector(
  selectCLNState,
  (cln) => cln.feeRate
);

export const selectInvoiceByHash = (paymentHash: string) => createSelector(
  selectListLightningTransactions,
  (data) => data.clnTransactions?.find(inv => inv.payment_hash === paymentHash)
);

export const selectPaymentByHash = (paymentHash: string) => createSelector(
  selectListLightningTransactions,
  (data) => data.clnTransactions?.find(pay => pay.payment_hash === paymentHash)
);

export const selectCurrentFeeRate = createSelector(
  selectFeeRate,
  (feeRate) => feeRate.onchain_fee_estimates?.opening_channel_satoshis || 0
);
