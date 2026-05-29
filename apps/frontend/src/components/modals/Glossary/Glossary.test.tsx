import { screen, fireEvent } from '@testing-library/react';
import Glossary from './Glossary';
import { renderWithProviders } from '../../../utilities/test-utilities/mockStore';
import { defaultRootState } from '../../../store/rootSelectors';
import { mockShowModals } from '../../../utilities/test-utilities/mockData';
import { defaultCLNState } from '../../../store/clnSelectors';
import { defaultBKPRState } from '../../../store/bkprSelectors';

describe('Glossary component', () => {
  let customMockStore;
  beforeEach(() => {
    customMockStore = {
      root: {
        ...defaultRootState,
        showModals: {
          ...mockShowModals,
          glossaryModal: true,
        },
      },
      cln: defaultCLNState,
      bkpr: defaultBKPRState,
    };
  });

  it('renders when glossaryModal is true', async () => {
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    expect(screen.getByTestId('glossary-modal')).toBeInTheDocument();
  });

  it('hides when glossaryModal is false', async () => {
    customMockStore.root.showModals.glossaryModal = false;
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    expect(screen.queryByTestId('glossary-modal')).not.toBeInTheDocument();
  });

  it('shows all 15 terms by default (search empty)', async () => {
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    expect(screen.getByTestId('glossary-term-factory')).toBeInTheDocument();
    expect(screen.getByTestId('glossary-term-musig2')).toBeInTheDocument();
    expect(screen.getByTestId('glossary-term-conformance')).toBeInTheDocument();
  });

  it('filters by term name', async () => {
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    const input = screen.getByTestId('glossary-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'musig' } });
    expect(screen.getByTestId('glossary-term-musig2')).toBeInTheDocument();
    expect(screen.queryByTestId('glossary-term-factory')).not.toBeInTheDocument();
  });

  it('filters by alias (case insensitive)', async () => {
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    const input = screen.getByTestId('glossary-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'kickoff transaction' } });
    /* "Kickoff TX" has alias "Kickoff transaction" — should match. */
    expect(screen.getByTestId('glossary-term-kickoff-tx')).toBeInTheDocument();
  });

  it('filters by definition substring', async () => {
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    const input = screen.getByTestId('glossary-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BIP-327' } });
    /* Only MuSig2's definition mentions BIP-327. */
    expect(screen.getByTestId('glossary-term-musig2')).toBeInTheDocument();
    expect(screen.queryByTestId('glossary-term-factory')).not.toBeInTheDocument();
  });

  it('shows empty state when no terms match', async () => {
    await renderWithProviders(<Glossary />, { preloadedState: customMockStore });
    const input = screen.getByTestId('glossary-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'xyzqq-no-such-term' } });
    expect(screen.getByTestId('glossary-empty')).toBeInTheDocument();
  });
});
