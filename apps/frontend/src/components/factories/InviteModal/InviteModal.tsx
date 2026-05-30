import { useMemo, useState } from 'react';
import { Modal, Button, Form, InputGroup, Alert } from 'react-bootstrap';
import { QRCodeSVG } from 'qrcode.react';
import { useSelector } from 'react-redux';
import { selectNodeInfo } from '../../../store/rootSelectors';
import { buildInviteUrl } from '../../../utilities/inviteUrl';
import type { Address } from '../../../types/root.type';

/* Address shape inspection — used for the privacy hint. Public-routable
 * IPv4/IPv6 reveal the LSP's location to anyone the URL is shared with;
 * .onion is privacy-preserving; loopback is local-only and effectively
 * benign for testnets / regtest demos. */
function classifyAddress(addr?: string): 'tor' | 'loopback' | 'private' | 'public' | null {
  if (!addr) return null;
  const host = addr.split(':')[0]?.toLowerCase() ?? '';
  if (!host) return null;
  if (host.endsWith('.onion')) return 'tor';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'loopback';
  // RFC1918 + loopback + link-local
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

/* Session 6a (Tier-2 polish): LSP-side invite modal.
 *
 * Shows a QR code + copyable superscalar:// URL that a client can use to
 * pre-fill the JoinFactoryModal. No plugin RPC needed — the LSP wallet
 * has everything: factory iid (from props), own node id (from getinfo),
 * and address (from listconfigs / first available listener).
 *
 * Operator can optionally constrain min/max requested capacity at invite-time
 * (these become defaults on the client side; client can still pick any
 * value, and the LSPs server-side acceptance policy is what actually
 * gates the join). */

type Props = {
  show: boolean;
  onHide: () => void;
  factoryInstanceIdHex: string;
  factoryLabel?: string;
};

function InviteModal({ show, onHide, factoryInstanceIdHex, factoryLabel }: Props) {
  const nodeInfo = useSelector(selectNodeInfo);
  const [minSats, setMinSats] = useState('');
  const [maxSats, setMaxSats] = useState('');
  const [copied, setCopied] = useState(false);
  /* Polish 2026-05-29: optional expiry. Default off (no field set) so
   * existing behavior (permanent invite) is preserved. When the operator
   * picks a duration, the URL gains an `expires` param and clients with
   * the wallet refuse to fire a join after that timestamp. */
  const [expiryDays, setExpiryDays] = useState<string>(''); // '' = no expiry
  /* Polish 2026-05-29: prefer tor over public ipv4 if both are present, since
   * a privacy-conscious LSP probably wants .onion shared, not their IP.
   * Operator can override by editing the URL or address logic later. */
  const [preferTor, setPreferTor] = useState(true);

  const ourNodeId: string | undefined = nodeInfo?.id;

  const candidateAddresses = useMemo(() => {
    const addrs: Address[] = nodeInfo?.address ?? [];
    const ipv4 = addrs.find((a) => a.type === 'ipv4');
    const ipv6 = addrs.find((a) => a.type === 'ipv6');
    const tor = addrs.find((a) => String(a.type).startsWith('torv'));
    return {
      ipv4: ipv4 ? `${ipv4.address}:${ipv4.port}` : undefined,
      ipv6: ipv6 ? `[${ipv6.address}]:${ipv6.port}` : undefined,
      tor: tor ? `${tor.address}:${tor.port}` : undefined,
    };
  }, [nodeInfo]);

  const address: string | undefined = useMemo(() => {
    if (preferTor && candidateAddresses.tor) return candidateAddresses.tor;
    return candidateAddresses.ipv4 || candidateAddresses.tor || candidateAddresses.ipv6;
  }, [candidateAddresses, preferTor]);

  const addressClass = classifyAddress(address);

  const expiresAt = useMemo(() => {
    if (!expiryDays) return undefined;
    const days = Number(expiryDays);
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  }, [expiryDays]);

  const inviteUrl = useMemo(() => {
    if (!ourNodeId) return null;
    return buildInviteUrl({
      iid: factoryInstanceIdHex,
      lspNodeId: ourNodeId,
      address,
      contributionMinSats: minSats ? Number(minSats) : undefined,
      contributionMaxSats: maxSats ? Number(maxSats) : undefined,
      label: factoryLabel,
      expiresAt,
    });
  }, [factoryInstanceIdHex, ourNodeId, address, minSats, maxSats, factoryLabel, expiresAt]);

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API blocked; user can still triple-click the text */
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size='lg'>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>Share invite for this factory</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className='text-muted mb-3' style={{ fontSize: '0.9rem' }}>
          Send this link or scan the QR to invite someone to join this factory. They paste it into <strong>Connect → Join via invite</strong>.
        </p>

        <div className='d-flex gap-3 mb-3'>
          <Form.Group className='flex-fill'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Min requested capacity (sats, optional)</Form.Label>
            <Form.Control
              type='text'
              inputMode='numeric'
              value={minSats}
              onChange={(e) => setMinSats(e.target.value)}
              placeholder='no minimum'
              data-testid='invite-min-sats'
            />
          </Form.Group>
          <Form.Group className='flex-fill'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Max requested capacity (sats, optional)</Form.Label>
            <Form.Control
              type='text'
              inputMode='numeric'
              value={maxSats}
              onChange={(e) => setMaxSats(e.target.value)}
              placeholder='no maximum'
              data-testid='invite-max-sats'
            />
          </Form.Group>
          <Form.Group className='flex-fill'>
            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Expires after</Form.Label>
            <Form.Select
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              data-testid='invite-expiry'
            >
              <option value=''>Never (recommended off)</option>
              <option value='1'>1 day</option>
              <option value='7'>1 week</option>
              <option value='30'>30 days</option>
              <option value='90'>90 days</option>
            </Form.Select>
          </Form.Group>
        </div>

        {/* Privacy & address controls */}
        {candidateAddresses.tor && candidateAddresses.ipv4 && (
          <Form.Check
            type='switch'
            id='invite-prefer-tor'
            label={`Prefer .onion address in URL (${candidateAddresses.tor.split(':')[0].slice(0, 16)}…)`}
            checked={preferTor}
            onChange={(e) => setPreferTor(e.target.checked)}
            className='mb-3'
            data-testid='invite-prefer-tor'
          />
        )}

        {addressClass === 'public' && (
          <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }} data-testid='invite-privacy-warning'>
            <strong>Privacy:</strong> this invite URL embeds your node&apos;s public IP address
            (<code>{address}</code>). Anyone with the URL can see it. {candidateAddresses.tor
              ? 'Toggle "Prefer .onion address" above to share a Tor hidden-service endpoint instead.'
              : 'If your node has a Tor onion address, configure CLN to advertise it and re-open this modal — the wallet will prefer it.'}
          </Alert>
        )}

        {!ourNodeId && (
          <div className='alert alert-warning'>
            Couldn&apos;t read your node ID. Wait a moment and try again.
          </div>
        )}

        {inviteUrl && (
          <>
            <div className='text-center mb-3' data-testid='invite-qr-wrap'>
              <QRCodeSVG value={inviteUrl} size={220} includeMargin />
            </div>

            <Form.Label className='mb-1' style={{ fontSize: '0.85rem' }}>Invite URL</Form.Label>
            <InputGroup>
              <Form.Control
                type='text'
                value={inviteUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                data-testid='invite-url'
                style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
              />
              <Button
                variant={copied ? 'success' : 'outline-secondary'}
                onClick={handleCopy}
                data-testid='invite-copy'
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </InputGroup>

            {!address && (
              <Form.Text className='text-warning mt-2'>
                Note: no IP address detected for your node. The client wallet will need to connect manually before the join can be sent.
              </Form.Text>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant='outline-secondary' onClick={onHide}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default InviteModal;
