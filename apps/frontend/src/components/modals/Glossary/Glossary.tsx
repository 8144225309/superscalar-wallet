import './Glossary.scss';
import { useMemo, useState } from 'react';
import { Modal, Form, Row } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';

import { CloseSVG } from '../../../svgs/Close';
import { setShowModals } from '../../../store/rootSlice';
import { selectShowModals } from '../../../store/rootSelectors';

type GlossaryTerm = {
  name: string;
  aka?: string[];
  tag: 'protocol' | 'crypto' | 'lifecycle' | 'lsp';
  def: string;
};

/* Source of truth for in-UI explanations of SuperScalar / bLIP-56 jargon.
 * Anything that appears in a tooltip elsewhere in the UI should also live
 * here so the operator has one searchable reference. */
const GLOSSARY: GlossaryTerm[] = [
  {
    name: 'Factory',
    tag: 'protocol',
    def: 'A bLIP-56 channel factory: a single on-chain UTXO that funds many off-chain Lightning channels via a Decker-Wattenhofer tree with PS-Spilman leaves. Lets a small set of participants share one on-chain transaction across many channels.',
  },
  {
    name: 'MuSig2',
    tag: 'crypto',
    def: 'BIP-327 stateless multi-signature scheme. SuperScalar uses MuSig2 for the n-of-n signing ceremonies that produce the kickoff and rotation transactions — one aggregated Schnorr signature, no per-participant inputs.',
  },
  {
    name: 'Epoch',
    tag: 'lifecycle',
    def: 'A period of channel state validity inside a factory. Each rotation increments the epoch; the previous epoch enters a breach-watch window during which the LSP can react to misbehavior.',
  },
  {
    name: 'Kickoff TX',
    aka: ['Kickoff transaction'],
    tag: 'lifecycle',
    def: 'The first on-chain transaction that funds the factory UTXO from participant contributions. Built and signed during the initial ceremony; once confirmed, the factory enters its first active epoch.',
  },
  {
    name: 'Rotation',
    aka: ['Factory rotation'],
    tag: 'lifecycle',
    def: 'A ceremony that produces a new epoch — re-signing the DW tree to update channel balances and refresh the breach-watch window. Required periodically before the previous burn TX timelock expires.',
  },
  {
    name: 'Breach window',
    aka: ['Breach epoch', 'Breach watch'],
    tag: 'lifecycle',
    def: 'Number of blocks after a rotation during which the LSP (or a watchtower) can publish a punishment transaction if a counterparty tries to broadcast a stale epoch. After this window closes, the prior epoch is unrecoverable.',
  },
  {
    name: 'DW timelock',
    aka: ['Decker-Wattenhofer timelock'],
    tag: 'protocol',
    def: 'Per-level timelock in the Decker-Wattenhofer tree structure. Successively shorter as you descend the tree; gives later epochs precedence over earlier ones during a unilateral exit.',
  },
  {
    name: 'PS-Spilman leaf',
    aka: ['Spilman leaf', 'PS leaf'],
    tag: 'protocol',
    def: 'Poon-Spilman style payment-channel leaf at the bottom of the DW tree. Each Lightning channel inside the factory terminates at one of these leaves.',
  },
  {
    name: 'L-stock',
    aka: ['Liquidity stock', 'L'],
    tag: 'lsp',
    def: 'The LSP\'s pool of inbound liquidity available for new client joins. Visible to clients browsing an LSP via factory-browse-host. Bounded by the LSP\'s policy (max-liquidity, reservation rules).',
  },
  {
    name: 'Cooperative close',
    aka: ['Coop close'],
    tag: 'lifecycle',
    def: 'Voluntary exit: all participants sign a final transaction that distributes funds on-chain without entering the breach window. Faster, cheaper, and avoids the timelock delays of a unilateral exit.',
  },
  {
    name: 'Force close',
    aka: ['Unilateral close', 'Burn'],
    tag: 'lifecycle',
    def: 'Exit without counterparty cooperation: publish the current epoch\'s burn transaction on-chain. Funds become spendable after the DW timelocks for your level expire.',
  },
  {
    name: 'Auto-sign',
    tag: 'lsp',
    def: 'LSP-side toggle: automatically sign any join proposal that meets a configured policy (amount cap, peer reputation). When off, every incoming proposal lands in the operator console for manual review.',
  },
  {
    name: 'Sign queue',
    tag: 'lsp',
    def: 'LSP-side persistence layer for pending signing decisions. Survives plugin restarts so an LSP that\'s briefly offline doesn\'t lose track of inbound joins.',
  },
  {
    name: 'Invite link',
    tag: 'protocol',
    def: 'A short URL or QR code an LSP shares to invite a client to join a specific factory or open a channel. Encodes the host pubkey, host address, and optional factory ID. Wallet-side: see Connect → Invite section.',
  },
  {
    name: 'CONFORMANCE',
    tag: 'protocol',
    def: 'Per-repo doc recording deliberate deviations from the bLIP-56 spec draft. The plugin tracks wire-type and message-format deviations; the wallet tracks UI-side ones. See docs/REPO_GOVERNANCE.md and the plugin\'s superscalar-cln CONFORMANCE.md.',
  },
];

const Glossary = () => {
  const dispatch = useDispatch();
  const showModals = useSelector(selectShowModals);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GLOSSARY;
    return GLOSSARY.filter(t => {
      if (t.name.toLowerCase().includes(q)) return true;
      if (t.def.toLowerCase().includes(q)) return true;
      if (t.aka?.some(a => a.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  const closeHandler = () => {
    dispatch(setShowModals({ ...showModals, glossaryModal: false }));
    setQuery('');
  };

  return (
    <Modal
      show={showModals.glossaryModal}
      onHide={closeHandler}
      centered
      className='modal-lg glossary-modal'
      data-testid='glossary-modal'
    >
      <Modal.Header className='d-flex align-items-start justify-content-between pb-0 border-0'>
        <h4 className='text-blue fw-bold mb-0'>Glossary</h4>
        <span className='span-close-svg' onClick={closeHandler} data-testid='glossary-close'>
          <CloseSVG />
        </span>
      </Modal.Header>
      <Modal.Body className='py-2'>
        <p className='fs-7 text-muted mb-3'>
          SuperScalar protocol and bLIP-56 terms you&apos;ll encounter in this wallet.
          Tooltips elsewhere in the UI point back here.
        </p>
        <Form.Control
          type='search'
          placeholder='Search terms or definitions…'
          value={query}
          onChange={e => setQuery(e.target.value)}
          className='glossary-search mb-3'
          autoFocus
          data-testid='glossary-search'
        />
        <Row className='m-0'>
          {filtered.length === 0 ? (
            <div className='glossary-empty' data-testid='glossary-empty'>
              No terms match &quot;{query}&quot;.
            </div>
          ) : (
            filtered.map(term => (
              <div
                key={term.name}
                className='glossary-term'
                data-testid={`glossary-term-${term.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <div className='glossary-term-name'>
                  {term.name}
                  <span className='glossary-term-tag'>{term.tag}</span>
                  {term.aka && (
                    <span className='ms-2 fs-7 text-muted'>
                      aka {term.aka.join(', ')}
                    </span>
                  )}
                </div>
                <div className='glossary-term-def'>{term.def}</div>
              </div>
            ))
          )}
        </Row>
      </Modal.Body>
    </Modal>
  );
};

export default Glossary;
