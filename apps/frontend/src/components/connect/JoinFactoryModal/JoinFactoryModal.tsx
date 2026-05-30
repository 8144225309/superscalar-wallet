import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Alert, Table, Badge } from 'react-bootstrap';
import InlineSpinner from '../../ui/InlineSpinner/InlineSpinner';
import { FactoriesService } from '../../../services/http.service';

/**
 * Join Factory Modal — client-side join flow.
 *
 * What it renders
 *   The modal a client opens after selecting an LSP (from ConnectList
 *   or via AcceptInviteModal). Loads the LSP's advertised factories
 *   via factory-browse-host, shows the per-factory L-stock and policy,
 *   lets the user pick one + requested capacity + optional notes, and
 *   fires factory-join-request.
 *
 * Key state
 *   - `lspPubkey` + `lspAddress` — connection target (from caller)
 *   - `factories` (LspBrowsedFactory[]) loaded from
 *     factory-browse-host
 *   - `selectedFactory`: row currently selected
 *   - `requestedCapacity`: input field for the join amount
 *   - `responseStatus` / `responseMessage` for StatusAlert
 *
 * Side effects
 *   - factory-browse-host on open
 *   - factory-join-request on submit
 *   - Optional autoConnect: peer-connect first if not already peered
 *
 * Props contract
 *   - `show: boolean` — visibility
 *   - `onHide: () => void` — close
 *   - `lspPubkey?: string` / `lspAddress?: string` — pre-filled target
 *   - `invite?: Invite` — when launched from AcceptInviteModal, pre-
 *     fills the requested capacity + factory iid
 */
type LspBrowsedFactory = {
  factory_instance_id?: string;
  instance_id?: string;
  lifecycle?: string;
  ceremony?: string;
  funding_sats?: number;
  funding_amount_sats?: number;
  n_clients?: number;
  n_participants?: number;
  creation_block?: number;
  per_client_capacity_sat?: number;
  /* policy fields are surfaced when the LSP carries them in FACTORY_INFO_RESPONSE */
  [k: string]: any;
};

type BrowseResult = {
  host_node_id?: string;
  factory_protocol_id?: string;
  snapshot_block?: number;
  factories?: LspBrowsedFactory[];
  factory_policies?: any[];
};

type Props = {
  show: boolean;
  onClose: () => void;
  lspPubkey: string;
  lspAlias: string;
  lnAddresses?: string[];
};

const truncate = (s: string, head = 10, tail = 6): string => {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const formatSats = (n?: number): string => {
  if (n == null) return '—';
  return n.toLocaleString();
};

const formatErr = (err: any, fallback: string): string => {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  try {
    const s = JSON.stringify(err);
    if (s && s !== '{}' && s !== 'null') return s;
  } catch { /* circular */ }
  return fallback;
};

const extractIid = (f: LspBrowsedFactory): string =>
  f.factory_instance_id || f.instance_id || '';

const extractCapacity = (f: LspBrowsedFactory): number | undefined =>
  f.funding_sats ?? f.funding_amount_sats;

function JoinFactoryModal({ show, onClose, lspPubkey, lspAlias, lnAddresses }: Props) {
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);

  const [selectedIid, setSelectedIid] = useState<string | null>(null);
  const [contributionStr, setContributionStr] = useState('100000');

  const [joinInFlight, setJoinInFlight] = useState(false);
  const [joinSuccess, setJoinSuccess] = useState<any>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const addressHint = useMemo(() => {
    if (!lnAddresses || lnAddresses.length === 0) return undefined;
    return lnAddresses[0];
  }, [lnAddresses]);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setBrowseLoading(true);
    setBrowseError(null);
    setBrowseResult(null);
    setSelectedIid(null);
    setJoinSuccess(null);
    setJoinError(null);

    FactoriesService.browseHost(lspPubkey, addressHint)
      .then((resp) => {
        if (cancelled) return;
        setBrowseResult(resp as BrowseResult);
      })
      .catch((err) => {
        if (!cancelled) {
          setBrowseError(formatErr(err,
            'Browse failed. The LSP may be offline or the address hint is unreachable.',
          ));
        }
      })
      .finally(() => {
        if (!cancelled) setBrowseLoading(false);
      });

    return () => { cancelled = true; };
  }, [show, lspPubkey, addressHint]);

  const factories = browseResult?.factories || [];
  const selectedFactory = factories.find((f) => extractIid(f) === selectedIid);

  const handleJoin = async () => {
    if (!selectedIid) return;
    const n = parseInt(contributionStr, 10);
    if (!Number.isFinite(n) || n < 0) {
      setJoinError('Requested capacity must be a non-negative integer (sats)');
      return;
    }
    setJoinInFlight(true);
    setJoinError(null);
    setJoinSuccess(null);
    try {
      const resp = await FactoriesService.joinRequest(lspPubkey, selectedIid, n, addressHint);
      setJoinSuccess(resp);
    } catch (err: any) {
      setJoinError(formatErr(err, 'Join request failed. The plugin RPC may have timed out.'));
    } finally {
      setJoinInFlight(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} size='lg' data-testid='join-factory-modal'>
      <Modal.Header closeButton>
        <Modal.Title>Join factory on {lspAlias}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div style={{ fontSize: '0.85rem', color: '#6c757d', marginBottom: '0.75rem' }}>
          LSP node_id <code>{truncate(lspPubkey, 12, 8)}</code>
          {addressHint && (
            <> · address hint <code>{addressHint}</code></>
          )}
          {!addressHint && (
            <> · <Badge bg='warning' text='dark'>no address in vouch — plugin will gossip-lookup</Badge></>
          )}
        </div>

        {browseLoading && (
          <div className='text-center my-4'>
            <InlineSpinner label='Browsing LSP factories' />
          </div>
        )}

        {browseError && (
          <Alert variant='danger' className='py-2'>
            <strong>Browse failed:</strong> {browseError}
          </Alert>
        )}

        {browseResult && !browseLoading && (
          <>
            <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              Protocol: <code>{browseResult.factory_protocol_id}</code>
              {browseResult.snapshot_block != null && (
                <> · snapshot block {browseResult.snapshot_block}</>
              )}
            </div>

            {factories.length === 0 ? (
              <Alert variant='info' className='py-2'>
                LSP has no factories currently advertised. They may need to create one first.
              </Alert>
            ) : (
              <>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '1rem', marginBottom: '0.5rem' }}>
                  Pick a factory to join
                </div>
                <Table size='sm' bordered hover>
                  <thead>
                    <tr style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                      <th style={{ width: '40px' }}></th>
                      <th>Factory ID</th>
                      <th style={{ textAlign: 'right' }}>Funding (sat)</th>
                      <th style={{ textAlign: 'center' }}>Participants</th>
                      <th>Lifecycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factories.map((f, i) => {
                      const iid = extractIid(f);
                      const isSel = iid === selectedIid;
                      return (
                        <tr
                          key={iid || i}
                          onClick={() => setSelectedIid(iid)}
                          style={{ cursor: 'pointer', backgroundColor: isSel ? 'rgba(13,110,253,0.1)' : undefined }}
                        >
                          <td>
                            <Form.Check
                              type='radio'
                              checked={isSel}
                              onChange={() => setSelectedIid(iid)}
                              data-testid={`pick-factory-${iid.slice(0, 8)}`}
                            />
                          </td>
                          <td><code style={{ fontSize: '0.8rem' }}>{truncate(iid, 14, 8)}</code></td>
                          <td style={{ textAlign: 'right' }}>{formatSats(extractCapacity(f))}</td>
                          <td style={{ textAlign: 'center' }}>{f.n_participants ?? f.n_clients ?? '—'}</td>
                          <td><Badge bg='secondary'>{f.lifecycle ?? '—'}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>

                {selectedFactory && (
                  <>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.75rem' }}>
                      Requested inbound capacity
                    </div>
                    <Form.Group className='mt-2'>
                      <Form.Control
                        type='number'
                        value={contributionStr}
                        min='0'
                        onChange={(e) => setContributionStr(e.target.value)}
                        data-testid='contribution-input'
                      />
                      <Form.Text className='text-muted' style={{ fontSize: '0.8rem' }}>
                        Inbound liquidity you are requesting from the LSP. The LSP funds it on-chain — you bring nothing. Default 100,000.
                      </Form.Text>
                    </Form.Group>
                  </>
                )}
              </>
            )}
          </>
        )}

        {joinSuccess && (
          <Alert variant='success' className='py-2 mt-3'>
            <strong>Join request sent.</strong>
            {joinSuccess.request_id && <> request_id <code>{joinSuccess.request_id}</code></>}
            {joinSuccess.status && <> · status <Badge bg='info'>{joinSuccess.status}</Badge></>}
            {joinSuccess.reason && <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{joinSuccess.reason}</div>}
          </Alert>
        )}

        {joinError && (
          <Alert variant='danger' className='py-2 mt-3'>
            <strong>Join failed:</strong> {joinError}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant='outline-secondary' onClick={onClose} disabled={joinInFlight}>
          Close
        </Button>
        <Button
          variant='primary'
          onClick={handleJoin}
          disabled={!selectedIid || joinInFlight || !!joinSuccess}
          data-testid='send-join-request'
        >
          {joinInFlight ? <InlineSpinner label='Sending join' /> : 'Send join request'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default JoinFactoryModal;
