import './FactoriesNav.scss';
import { Link, useLocation } from 'react-router-dom';
import { Nav } from 'react-bootstrap';

/**
 * Factories Nav — pill row across every /factories sub-page (Polish #2.7).
 *
 * What it renders
 *   A 6-pill nav (Overview / LSP Console / LSP Prefs / Signing Prefs /
 *   Known Peers / Host Factory) replacing the 4 tiny `›` footer links
 *   that previously hid sub-pages from anyone who didn't scroll to the
 *   bottom.
 *
 * Active-pill matching
 *   Driven by `isActive(pathname, section)`:
 *   - Overview pill matches ONLY `/factories` or `/factories/` —
 *     never a deeper path, so navigating into a sub-page doesn't
 *     keep Overview visually highlighted.
 *   - Every other section uses prefix-or-sub-path match (e.g.
 *     `/factories/console` and `/factories/console/anything`).
 *   - Factory-detail deep paths (`/factories/<iid>`) leave ALL pills
 *     inactive — the user is "off the nav row".
 *
 * Side effects
 *   None — pure routing-driven render.
 *
 * Props contract
 *   None — reads useLocation() and emits <Link to=...> for each pill.
 *
 * Test coverage
 *   FactoriesNav.test.tsx pins the 6 cases described above.
 */

type Section = {
  to: string;
  label: string;
  testid: string;
  /** Suffix matched against pathname; multiple entries OR'd. */
  match: string[];
};

const SECTIONS: Section[] = [
  { to: '/factories',                label: 'Overview',     testid: 'nav-overview',     match: ['/factories'] },
  { to: '/factories/console',        label: 'LSP Console',  testid: 'nav-console',      match: ['/factories/console'] },
  { to: '/factories/operator-prefs', label: 'LSP Prefs',    testid: 'nav-operator-prefs', match: ['/factories/operator-prefs'] },
  { to: '/factories/signing-prefs',  label: 'Signing Prefs',testid: 'nav-signing-prefs',  match: ['/factories/signing-prefs'] },
  { to: '/factories/peers',          label: 'Known Peers',  testid: 'nav-peers',         match: ['/factories/peers'] },
  { to: '/factories/create',         label: 'Host Factory', testid: 'nav-create',        match: ['/factories/create'] },
];

function isActive(pathname: string, section: Section): boolean {
  /* "/factories" must only match the bare root, not e.g. "/factories/console".
   * For the rest we match prefix exactly. */
  if (section.to === '/factories') {
    return pathname === '/factories' || pathname === '/factories/';
  }
  return section.match.some((m) => pathname === m || pathname.startsWith(m + '/'));
}

function FactoriesNav() {
  const { pathname } = useLocation();
  return (
    <Nav
      className='factories-nav mb-3 px-3 d-flex flex-wrap gap-2'
      data-testid='factories-nav'
    >
      {SECTIONS.map((s) => {
        const active = isActive(pathname, s);
        return (
          <Nav.Item key={s.to}>
            <Link
              to={s.to}
              className={
                'btn btn-sm ' +
                (active ? 'btn-primary' : 'btn-outline-secondary')
              }
              data-testid={s.testid}
              aria-current={active ? 'page' : undefined}
            >
              {s.label}
            </Link>
          </Nav.Item>
        );
      })}
    </Nav>
  );
}

export default FactoriesNav;
