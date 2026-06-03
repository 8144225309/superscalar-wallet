import { useState } from 'react';
import { Modal, Button, Form, Alert, Spinner } from 'react-bootstrap';
import { NodesService } from '../../../services/http.service';
import logger from '../../../services/logger.service';

/**
 * Add Node Modal — register a new CLN profile from the UI.
 *
 * What it renders
 *   A form to add a CLN node profile to the wallet without hand-editing
 *   node-profiles.json or POSTing /v1/nodes manually. Fields:
 *   - Label (optional, human-friendly name)
 *   - Pubkey (66 hex chars)
 *   - Address (host:port or pubkey@host:port — split automatically)
 *   - Rune (commando bearer secret for this node)
 *
 *   Closes the S2 gap from USER_FLOWS.md: adding the first node was the
 *   single most basic operator task with no UI — it required editing
 *   JSON or running curl.
 *
 * Validation (client-side, before POST)
 *   - Pubkey: /^0[23][0-9a-fA-F]{64}$/ (33-byte compressed secp256k1)
 *   - Address: host:port where port is 1-5 digits; host shape is left to
 *     CLN's connectd (IPv4 / IPv6 / .onion / DNS all valid)
 *   - Rune: non-empty (format is opaque; the node validates it)
 *
 * Convenience
 *   Pasting "pubkey@host:port" into the pubkey field auto-splits it into
 *   the pubkey + address fields — same affordance as ManualConnectModal.
 *
 * Side effects
 *   - NodesService.addNode() → POST /v1/nodes (backend addProfile)
 *   - On success: NodesService.fetchAndDispatchNodes() refreshes the
 *     Redux profile list so the new node appears in the picker immediately
 *
 * Props contract
 *   - `show: boolean` — visibility
 *   - `onHide: () => void` — close handler
 *   - `onAdded?: (profileId: string) => void` — fired after a successful
 *     add so the parent can offer to switch to the new profile
 */

const PUBKEY_RE = /^0[23][0-9a-fA-F]{64}$/;
/* host:port — port is 1-5 digits. Host shape (IPv4 / IPv6 / .onion / DNS)
 * is left to CLN's connectd; we don't over-validate. */
const ADDRESS_RE = /^[^\s/@]+:[0-9]{1,5}$/;

type Props = {
  show: boolean;
  onHide: () => void;
  onAdded?: (profileId: string) => void;
};

function AddNodeModal({ show, onHide, onAdded }: Props) {
  const [label, setLabel] = useState('');
  const [pubkey, setPubkey] = useState('');
  const [address, setAddress] = useState('');
  const [rune, setRune] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setLabel('');
    setPubkey('');
    setAddress('');
    setRune('');
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onHide();
  };

  /* Accept "<pubkey>@<host:port>" pasted into the pubkey field and split
   * it — this is the format CLN's `connect` cmd uses, so it's the most
   * common thing someone will paste. Same affordance as ManualConnectModal. */
  const handlePubkeyChange = (v: string) => {
    const trimmed = v.trim();
    const atIdx = trimmed.indexOf('@');
    if (atIdx > 0 && atIdx < trimmed.length - 1) {
      const left = trimmed.slice(0, atIdx);
      const right = trimmed.slice(atIdx + 1);
      if (PUBKEY_RE.test(left)) {
        setPubkey(left);
        if (!address) setAddress(right);
        return;
      }
    }
    setPubkey(trimmed);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const pk = pubkey.trim();
    const addr = address.trim();
    const rn = rune.trim();
    const lbl = label.trim();

    if (!PUBKEY_RE.test(pk)) {
      setError('Pubkey must be 66 hex chars (33-byte compressed secp256k1, starts with 02 or 03).');
      return;
    }
    if (!ADDRESS_RE.test(addr)) {
      setError('Address must be host:port (e.g. 127.0.0.1:9735 or example.onion:9735).');
      return;
    }
    if (!rn) {
      setError('Rune is required — generate one on the node with `lightning-cli createrune`.');
      return;
    }

    const [wsHost, wsPortStr] = addr.split(':');
    const wsPort = Number(wsPortStr);
    if (!Number.isFinite(wsPort) || wsPort <= 0 || wsPort > 65535) {
      setError('Port must be a number between 1 and 65535.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await NodesService.addNode({
        pubkey: pk,
        rune: rn,
        wsHost,
        wsPort,
        label: lbl || undefined,
      });
      // Refresh the Redux profile list so the new node appears in the picker.
      await NodesService.fetchAndDispatchNodes();
      const newId = res?.profile?.id;
      reset();
      onHide();
      if (newId && onAdded) onAdded(newId);
    } catch (err: any) {
      logger.error('Add node profile failed:', err);
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to add node — check the address and rune.';
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered size='lg' data-testid='add-node-modal'>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>Add a CLN node</Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          <p className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
            Connect the wallet to another Core Lightning node. You&apos;ll need the
            node&apos;s pubkey, its commando WebSocket address, and a rune. Generate
            a rune on the node with <code>lightning-cli createrune</code>.
          </p>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Label (optional)</Form.Label>
            <Form.Control
              type='text'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='e.g. My signet node'
              data-testid='add-node-label'
              disabled={submitting}
            />
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Node pubkey (66 hex chars)</Form.Label>
            <Form.Control
              type='text'
              value={pubkey}
              onChange={(e) => handlePubkeyChange(e.target.value)}
              placeholder='02ab… or 02ab…@127.0.0.1:9735'
              data-testid='add-node-pubkey'
              style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              autoFocus
              disabled={submitting}
            />
            <Form.Text className='text-muted'>
              Tip: paste <code>pubkey@host:port</code> and we&apos;ll split it for you.
            </Form.Text>
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Commando WebSocket address (host:port)</Form.Label>
            <Form.Control
              type='text'
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder='127.0.0.1:9735'
              data-testid='add-node-address'
              style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              disabled={submitting}
            />
            <Form.Text className='text-muted'>
              The node must have <code>bind-addr=ws:HOST:PORT</code> set in its config.
            </Form.Text>
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Rune</Form.Label>
            <Form.Control
              as='textarea'
              rows={2}
              value={rune}
              onChange={(e) => setRune(e.target.value)}
              placeholder='Generate with: lightning-cli createrune'
              data-testid='add-node-rune'
              style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
              disabled={submitting}
            />
            <Form.Text className='text-muted'>
              Stored locally on the wallet server and never exposed back to the browser.
            </Form.Text>
          </Form.Group>

          {error && (
            <Alert variant='warning' className='py-2 mb-0' style={{ fontSize: '0.85rem' }} data-testid='add-node-error'>
              {error}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant='outline-secondary' onClick={handleClose} type='button' disabled={submitting}>
            Cancel
          </Button>
          <Button variant='primary' type='submit' data-testid='add-node-submit' disabled={submitting}>
            {submitting ? (
              <>
                <Spinner animation='border' size='sm' className='me-2' />
                Adding…
              </>
            ) : (
              'Add node'
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export default AddNodeModal;
