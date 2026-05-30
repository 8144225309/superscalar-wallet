import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FactoriesNav from './FactoriesNav';

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <FactoriesNav />
    </MemoryRouter>,
  );
}

describe('FactoriesNav', () => {
  it('renders all six pill destinations', () => {
    renderAt('/factories');
    expect(screen.getByTestId('nav-overview')).toBeInTheDocument();
    expect(screen.getByTestId('nav-console')).toBeInTheDocument();
    expect(screen.getByTestId('nav-operator-prefs')).toBeInTheDocument();
    expect(screen.getByTestId('nav-signing-prefs')).toBeInTheDocument();
    expect(screen.getByTestId('nav-peers')).toBeInTheDocument();
    expect(screen.getByTestId('nav-create')).toBeInTheDocument();
  });

  it('marks Overview active on the bare /factories path', () => {
    renderAt('/factories');
    expect(screen.getByTestId('nav-overview')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-console')).not.toHaveAttribute('aria-current', 'page');
  });

  it('marks Overview active on /factories/ (trailing slash variant)', () => {
    renderAt('/factories/');
    expect(screen.getByTestId('nav-overview')).toHaveAttribute('aria-current', 'page');
  });

  it('does NOT mark Overview active on a deeper /factories/console path', () => {
    renderAt('/factories/console');
    expect(screen.getByTestId('nav-overview')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-console')).toHaveAttribute('aria-current', 'page');
  });

  it('marks each section active when on its exact path', () => {
    for (const [path, testid] of [
      ['/factories/console', 'nav-console'],
      ['/factories/operator-prefs', 'nav-operator-prefs'],
      ['/factories/signing-prefs', 'nav-signing-prefs'],
      ['/factories/peers', 'nav-peers'],
      ['/factories/create', 'nav-create'],
    ] as const) {
      renderAt(path);
      expect(screen.getByTestId(testid)).toHaveAttribute('aria-current', 'page');
    }
  });

  it('does NOT mark any section active on a factory-detail deep path', () => {
    /* /factories/<iid> doesn't match any of the listed match prefixes,
     * so all pills are inactive on the detail view. */
    renderAt('/factories/abc123def456');
    expect(screen.getByTestId('nav-overview')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-console')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-operator-prefs')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-signing-prefs')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-peers')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-create')).not.toHaveAttribute('aria-current', 'page');
  });

  it('matches sub-paths under a section (e.g. /factories/console/anything)', () => {
    renderAt('/factories/console/some-sub-route');
    expect(screen.getByTestId('nav-console')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the active pill with primary class and inactive with outline-secondary', () => {
    renderAt('/factories/console');
    expect(screen.getByTestId('nav-console').className).toContain('btn-primary');
    expect(screen.getByTestId('nav-peers').className).toContain('btn-outline-secondary');
  });
});
