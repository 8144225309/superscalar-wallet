import { useEffect, useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import InlineSpinner from '../../ui/InlineSpinner/InlineSpinner';
import { parseInviteUrlDetailed, Invite } from '../../../utilities/inviteUrl';
import { FactoriesService } from '../../../services/http.service';

/* Address class used by the "trust this address" gate. Public IPs mean the
 * wallet's about to phone home to a stranger's box; loopback is local dev /
 * regtest demo; tor is privacy-preserving; private means inside the same
 * NAT (usually fine but worth surfacing). */
function classifyAddress(addr?: string): 'tor' | 'loopback' | 'private' | 'public' | null {
  if (!addr) return null;
  const host = addr.split(':')[0]?.toLowerCase() ?? '';
  if (!host) return null;
  if (host.endsWith('.onion')) return 'tor';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'loopback';
  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^fe80:/.test(host) ||
    /^fc[0-9a-f]{2}:/.test(host) ||
    /^fd[0-9a-f]{2}:/.test(host)
  ) return 'private';
  return 'public';
}

/* Session 6a (Tier-2 polish): client-side "Join via invite" modal.
 *
 * User pastes a superscalar://join?... URL (or scans a QR with an
 * external reader and pastes the result). We parse, show what was
 * decoded, let them pick a requested capacity within the optional
 * min/max range, then call factory-join-request via FactoriesService.
 *
 * The plugins existing auto-connect helper handles the BOLT-8 hop if
 * the LSP isnt already connected (the address from the invite goes in
 * as the hint). */

type Props = {
  show: boolean;
  onHide: () => void;
};

function AcceptInviteModal({ show, onHide }: Props) {
  const [urlInput, setUrlInput] = useState('');
  const [parsed, setParsed] = useState<Invite | null>(null);
  const [contribution, setContribution] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /* Polish 2026-05-29: explicit trust gate when the invite points at a
   * publicly-routable IP. Loopback / tor / private don't require this. */
  const [trustAcked, setTrustAcked] = useState(false);

  useEffect(() => {
    if (!urlInput.trim()) {
      setParsed(null);
      setError(null);
      return;
    }
    const r = parseInviteUrlDetailed(urlInput);
    if (!r.invite) {
      setParsed(null);
      if (r.error === 'expired') {
        setError('This invite expired. Ask the LSP operator for a fresh one.');
      } else {
        setError('Not a valid superscalar:// invite. Expected format: superscalar://join?iid=…&lsp=…');
      }
    } else {
      setParsed(r.invite);
      setError(null);
      if (r.invite.contributionMinSats != null && !contribution) {
        setContribution(String(r.invite.contributionMinSats));
      }
    }
    // eslint-disable-next-line
  }, [urlInput]);

  const handleJoin = async () => {
    if (!parsed) return;
    const n = Number(contribution);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Pick a requested capacity in sats first.');
      return;
    }
    if (parsed.contributionMinSats != null && n < parsed.contributionMinSats) {
      setError(`Below LSP minimum (${parsed.contributionMinSats.toLocaleString()} sats).`);
      return;
    }
    if (parsed.contributionMaxSats != null && n > parsed.contributionMaxSats) {
      setError(`Above LSP maximum (${parsed.contributionMaxSats.toLocaleString()} sats).`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await FactoriesService.joinRequest(
        parsed.lspNodeId,
        parsed.iid,
        n,
        parsed.address,
      );
      setSuccess(`Join request sent to LSP ${parsed.lspNodeId.slice(0, 12)}… for ${n.toLocaleString()} sats. Watch the factories page for status.`);
      setTimeout(() => {
        setSuccess(null);
        setUrlInput('');
        setContribution('');
        setParsed(null);
        onHide();
      }, 3000);
    } catch (e: any) {
      setError(`Join failed: ${e?.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size='lg'>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>Join via invite</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
          Paste a <code>superscalar://join?…</code> URL from an LSP. The wallet decodes the factory and LSP node, you pick how much inbound capacity to request, and we send the join request.
        </p>

        <Form.Group className='mb-3'>
          <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Invite URL</Form.Label>
          <Form.Control
            as='textarea'
            rows={2}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder='superscalar://join?iid=…&lsp=…&address=…'
            data-testid='accept-invite-url'
            style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
          />
        </Form.Group>

        {parsed && (
          <div className='border rounded p-3 mb-3' style={{ fontSize: '0.85rem' }}>
            <div><strong>Factory:</strong> <code>{parsed.iid.slice(0, 16)}…{parsed.iid.slice(-4)}</code></div>
            <div><strong>LSP:</strong> <code>{parsed.lspNodeId.slice(0, 16)}…{parsed.lspNodeId.slice(-4)}</code></div>
            {parsed.address && <div><strong>Address:</strong> <code>{parsed.address}</code></div>}
            {parsed.label && <div><strong>Label:</strong> {parsed.label}</div>}
            {(parsed.contributionMinSats != null || parsed.contributionMaxSats != null) && (
              <div className='mt-1 text-muted' style={{ fontSize: '0.8rem' }}>
                LSP requests:{' '}
                {parsed.contributionMinSats != null ? `min ${parsed.contributionMinSats.toLocaleString()} sats ` : ''}
                {parsed.contributionMaxSats != null ? `max ${parsed.contributionMaxSats.toLocaleString()} sats` : ''}
              </div>
            )}
          </div>
        )}

        {parsed && (
          <Form.Group className='mb-3'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Requested capacity (sats)</Form.Label>
            <Form.Control
              type='text'
              inputMode='numeric'
              value={contribution}
              onChange={(e) => setContribution(e.target.value)}
              placeholder='e.g. 100000'
              data-testid='accept-invite-contribution'
            />
          </Form.Group>
        )}

        {parsed && (() => {
          const cls = classifyAddress(parsed.address);
          if (cls === 'public') {
            return (
              <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }} data-testid='accept-invite-trust-gate'>
                <div className='mb-2'>
                  <strong>Heads up:</strong> sending this join request will phone home to
                  a publicly-routable IP, <code>{parsed.address}</code>. Make sure you got this
                  invite from a person you actually trust.
                </div>
                <Form.Check
                  type='checkbox'
                  id='accept-invite-trust-ack'
                  label="I trust the source of this invite and want to connect."
                  checked={trustAcked}
                  onChange={(e) => setTrustAcked(e.target.checked)}
                  data-testid='accept-invite-trust-ack'
                />
              </Alert>
            );
          }
          if (cls === 'tor') {
            return (
              <Alert variant='info' className='py-2 mb-3' style={{ fontSize: '0.85rem' }} data-testid='accept-invite-tor-note'>
                Connecting via Tor onion (<code>{parsed.address}</code>). Privacy-preserving.
              </Alert>
            );
          }
          return null;
        })()}

        {error && <Alert variant='warning' className='py-2 mb-2'>{error}</Alert>}
        {success && <Alert variant='success' className='py-2 mb-2'>{success}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant='outline-secondary' onClick={onHide} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant='primary'
          disabled={
            !parsed ||
            submitting ||
            success !== null ||
            (classifyAddress(parsed?.address) === 'public' && !trustAcked)
          }
          onClick={handleJoin}
          data-testid='accept-invite-submit'
        >
          {submitting ? <InlineSpinner label='Sending' /> : 'Send join request'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default AcceptInviteModal;
