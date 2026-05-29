import './FactoriesNav.scss';
import { Link, useLocation } from 'react-router-dom';
import { Nav } from 'react-bootstrap';

/* Polish #2.7: nav pill row across the top of every /factories sub-page.
 * Replaces the 4 tiny `›` footer links that previously hid sub-pages
 * from anyone who didn't scroll to the bottom. Each pill highlights when
 * the user is on its route. Overview pill takes them back to the root
 * /factories view (the dashboard with FactoryList + ExpiryWarnings etc).
 *
 * Routes are matched by suffix so deep nested paths still work
 * (e.g. /factories/<iid> detail page leaves all pills inactive). */

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
