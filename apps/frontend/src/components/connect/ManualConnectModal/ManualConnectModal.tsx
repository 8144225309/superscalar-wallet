import { useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';

/**
 * Manual Connect Modal — pubkey@host:port direct-target form (Task #119).
 *
 * What it renders
 *   The form that fills the gap between rendezvous-discovered LSPs
 *   (in ConnectList's discovered tab) and full invite URLs (which
 *   bake in a specific iid). The user pastes a "pubkey@host:port"
 *   string and the parent pops JoinFactoryModal pointed at that LSP.
 *
 *   Trigger scenario: someone DMs you "my LSP is X, browse my
 *   factories" without sending a full invite link.
 *
 * Validation
 *   - Pubkey must be 66 hex chars
 *   - Host:port required and parses successfully
 *
 * Side effects
 *   None — the parent owns the BOLT-8 connect via the plugin's
 *   auto-connect helper (#118).
 *
 * Props contract
 *   - `show: boolean`
 *   - `onHide: () => void`
 *   - `onSubmit: (pubkey, address) => void` — fires on valid submit
 *
 * No plugin RPC of our own: factory-browse-host (called by
 * JoinFactoryModal) takes a peer + optional address hint, and the plugin
 * connects on demand. */

type Props = {
  show: boolean;
  onHide: () => void;
  onConnect: (lspPubkey: string, address: string | undefined, lspAlias: string) => void;
};

const PUBKEY_RE = /^[0-9a-fA-F]{66}$/;
/* host:port — host is anything non-whitespace, port is 1..5 digits. We do
 * NOT try to validate the host shape strictly (IPv4 / IPv6 / .onion /
 * DNS all valid), CLN's connectd does the real check. */
const ADDRESS_RE = /^[^\s/@]+:[0-9]{1,5}$/;

function ManualConnectModal({ show, onHide, onConnect }: Props) {
  const [pubkey, setPubkey] = useState('');
  const [address, setAddress] = useState('');
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const pk = pubkey.trim();
    const addr = address.trim();
    const al = alias.trim();

    if (!PUBKEY_RE.test(pk)) {
      setError('Pubkey must be 66 hex chars (33 bytes, secp256k1 compressed).');
      return;
    }
    if (addr && !ADDRESS_RE.test(addr)) {
      setError('Address must be host:port (e.g. 1.2.3.4:9735 or example.onion:9735).');
      return;
    }
    setError(null);
    onConnect(pk, addr || undefined, al || pk.slice(0, 8) + '…' + pk.slice(-4));
    // Reset for next time
    setPubkey('');
    setAddress('');
    setAlias('');
  };

  const handleClose = () => {
    setError(null);
    onHide();
  };

  /* Convenience: accept "<pubkey>@<host:port>" pasted into the pubkey field
   * and split it for the user — this is the format CLN's `connect` cmd
   * uses, so it's the most common thing someone will paste. */
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

  return (
    <Modal show={show} onHide={handleClose} centered size='lg' data-testid='manual-connect-modal'>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>Connect to an LSP manually</Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          <p className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
            Enter an LSP&apos;s node pubkey and address. We connect, fetch its public factory
            inventory, and let you pick one to join. Use this when someone shares their LSP
            details out-of-band instead of an invite link or a rendezvous-advertised entry.
          </p>
          <p className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
            <strong>Tip:</strong> you can paste a full <code>&lt;pubkey&gt;@&lt;host:port&gt;</code> into the
            pubkey field and we&apos;ll split it for you.
          </p>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>LSP pubkey (66 hex chars)</Form.Label>
            <Form.Control
              type='text'
              value={pubkey}
              onChange={(e) => handlePubkeyChange(e.target.value)}
              placeholder='0212ab… or 0212ab…@1.2.3.4:9735'
              data-testid='manual-connect-pubkey'
              style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              autoFocus
            />
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Address (host:port, optional if already a peer)</Form.Label>
            <Form.Control
              type='text'
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder='1.2.3.4:9735 or example.onion:9735'
              data-testid='manual-connect-address'
              style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
            />
            <Form.Text className='text-muted'>
              If you&apos;ve already connected to this LSP in another session you can leave this
              blank — the wallet will use the existing peer connection. Required the first time.
            </Form.Text>
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Display label (optional)</Form.Label>
            <Form.Control
              type='text'
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder='e.g. Friend Alice — defaults to truncated pubkey'
              data-testid='manual-connect-alias'
            />
          </Form.Group>

          {error && (
            <Alert variant='warning' className='py-2 mb-0' style={{ fontSize: '0.85rem' }} data-testid='manual-connect-error'>
              {error}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant='outline-secondary' onClick={handleClose} type='button'>
            Cancel
          </Button>
          <Button variant='primary' type='submit' data-testid='manual-connect-submit'>
            Connect &amp; browse
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export default ManualConnectModal;
