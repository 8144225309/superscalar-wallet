import { useMemo, useState } from 'react';
import { Modal, Button, Form, InputGroup } from 'react-bootstrap';
import { QRCodeSVG } from 'qrcode.react';
import { useSelector } from 'react-redux';
import { selectNodeInfo } from '../../../store/rootSelectors';
import { buildInviteUrl } from '../../../utilities/inviteUrl';

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
  const nodeInfo: any = useSelector(selectNodeInfo);
  const [minSats, setMinSats] = useState('');
  const [maxSats, setMaxSats] = useState('');
  const [copied, setCopied] = useState(false);

  const ourNodeId: string | undefined = nodeInfo?.id;
  const address: string | undefined = useMemo(() => {
    const addrs = nodeInfo?.address ?? [];
    const ipv4 = addrs.find((a: any) => a.type === 'ipv4');
    if (ipv4) return `${ipv4.address}:${ipv4.port}`;
    const tor = addrs.find((a: any) => String(a.type).startsWith('torv'));
    if (tor) return `${tor.address}:${tor.port}`;
    return undefined;
  }, [nodeInfo]);

  const inviteUrl = useMemo(() => {
    if (!ourNodeId) return null;
    return buildInviteUrl({
      iid: factoryInstanceIdHex,
      lspNodeId: ourNodeId,
      address,
      contributionMinSats: minSats ? Number(minSats) : undefined,
      contributionMaxSats: maxSats ? Number(maxSats) : undefined,
      label: factoryLabel,
    });
  }, [factoryInstanceIdHex, ourNodeId, address, minSats, maxSats, factoryLabel]);

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
        </div>

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
