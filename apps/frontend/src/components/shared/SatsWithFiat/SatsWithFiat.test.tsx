import { screen } from '@testing-library/react';
import SatsWithFiat from './SatsWithFiat';
import { renderWithProviders } from '../../../utilities/test-utilities/mockStore';
import { defaultRootState } from '../../../store/rootSelectors';
import { defaultCLNState } from '../../../store/clnSelectors';
import { defaultBKPRState } from '../../../store/bkprSelectors';

function storeWithSettings(showFiat: boolean, rate: number, fiatUnit = 'USD') {
  return {
    root: {
      ...defaultRootState,
      appConfig: {
        ...defaultRootState.appConfig,
        uiConfig: {
          ...defaultRootState.appConfig.uiConfig,
          showFiatBesideSats: showFiat,
          fiatUnit,
        },
      },
      fiatConfig: { ...defaultRootState.fiatConfig, rate, isLoading: false },
    },
    cln: defaultCLNState,
    bkpr: defaultBKPRState,
  };
}

describe('SatsWithFiat', () => {
  it('renders the sats number formatted with locale thousands separators', async () => {
    await renderWithProviders(
      <SatsWithFiat value={1234567} />,
      { useRouter: false, preloadedState: storeWithSettings(false, 0) },
    );
    /* The default toLocaleString in en-US would produce 1,234,567.
     * Just confirm at least the digits are present in some grouped form. */
    expect(screen.getByText(/1.234.567|1,234,567/)).toBeInTheDocument();
  });

  it('does NOT render the fiat suffix when showFiatBesideSats is OFF', async () => {
    await renderWithProviders(
      <SatsWithFiat value={1000} />,
      { useRouter: false, preloadedState: storeWithSettings(false, 65000) },
    );
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
  });

  it('renders the fiat suffix when showFiatBesideSats is ON AND rate > 0', async () => {
    await renderWithProviders(
      <SatsWithFiat value={1_000_000} />,
      { useRouter: false, preloadedState: storeWithSettings(true, 65000) },
    );
    expect(screen.getByText(/≈/)).toBeInTheDocument();
    expect(screen.getByText(/USD/)).toBeInTheDocument();
  });

  it('omits the fiat suffix when showFiat is ON but rate is 0 (still loading)', async () => {
    await renderWithProviders(
      <SatsWithFiat value={1000} />,
      { useRouter: false, preloadedState: storeWithSettings(true, 0) },
    );
    /* Defensive: when rate hasn't loaded, don't display a "≈ $0" misleading suffix. */
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('honours the user-selected fiatUnit label', async () => {
    await renderWithProviders(
      <SatsWithFiat value={1_000_000} />,
      { useRouter: false, preloadedState: storeWithSettings(true, 65000, 'EUR') },
    );
    expect(screen.getByText(/EUR/)).toBeInTheDocument();
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
  });

  it('renders "0" when value is a non-numeric string', async () => {
    await renderWithProviders(
      <SatsWithFiat value={'not-a-number'} />,
      { useRouter: false, preloadedState: storeWithSettings(false, 0) },
    );
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
