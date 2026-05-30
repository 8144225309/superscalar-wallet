import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Button, Badge, Spinner, Alert, Form, Modal } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';
import SatsWithFiat from '../../shared/SatsWithFiat/SatsWithFiat';

/**
 * Join Requests Card — LSP UI slice A (task #82 supporting piece).
 *
 * What it renders
 *   The incoming join-queue inbox for ONE factory. Where
 *   LspOperatorConsole aggregates across all factories,
 *   JoinRequestsCard scopes to a single iid for the FactoryDetail page.
 *
 * Key state
 *   - `entries`: `lsp_join_queue` rows for this factory iid
 *   - `actionState`: per-row pending/error UI state
 *   - polling cadence: 5s (matches surrounding factory-data polls)
 *
 * Side effects
 *   - Plugin RPCs: wallet-list-join-queue-by-status (poll),
 *     wallet-approve-join-queued, wallet-refuse-join-queued
 *
 * Props contract
 *   `factoryInstanceIdHex: string` — the iid this card scopes to.
 *   Parent (FactoryDetail) guards on `factory.is_lsp` before mounting;
 *   this card assumes LSP role.
 */

type JoinEntry = {
  factory_instance_id_hex: string;
  client_pubkey_hex: string;
  request_id: string;
  contribution_sats: string;
  received_at_block: number;
  accepted_at_block: number | null;
  decided_at_block: number | null;
  last_seen_block: number | null;
  status: number;       /* 0 QUEUED, 1 ACCEPTED, 2 SIGNED, 3 REJECTED, 4 CANCELLED, 5 ALREADY_MEMBER */
  reason: string | null;
};

/* Mirror of the LspOperatorConsole status badge map. Constrain `text`
 * to the Bootstrap color-token union so the Badge JSX consumer doesn't
 * need an `as any` cast. */
type BadgeTextColor = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark' | 'muted' | 'white' | 'body' | 'black';

const STATUS_LABEL: Record<number, { label: string; bg: string; text: BadgeTextColor }> = {
  0: { label: 'Queued', bg: 'warning', text: 'dark' },
  1: { label: 'Accepted', bg: 'info', text: 'dark' },
  2: { label: 'Signed', bg: 'success', text: 'light' },
  3: { label: 'Rejected', bg: 'danger', text: 'light' },
  4: { label: 'Cancelled', bg: 'secondary', text: 'light' },
  5: { label: 'Already member', bg: 'secondary', text: 'light' },
};

const short = (hex: string, n = 8): string => hex.length > n + 4 ? `${hex.slice(0, n)}…${hex.slice(-4)}` : hex;

type Props = {
  factoryInstanceIdHex: string;
  currentBlock: number;
};

function JoinRequestsCard({ factoryInstanceIdHex, currentBlock }: Props) {
  const [entries, setEntries] = useState<JoinEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyClient, setBusyClient] = useState<string | null>(null);
  const [refuseTarget, setRefuseTarget] = useState<JoinEntry | null>(null);
  const [refuseReason, setRefuseReason] = useState('');

  const loadEntries = async () => {
    try {
      /* Fetch all statuses (0..5) so the operator sees full history per factory. */
      const fetched: JoinEntry[] = [];
      for (const status of [0, 1, 2, 3, 4, 5]) {
        const r = await FactoriesService.listJoinQueueByStatus(factoryInstanceIdHex, status);
        if (r && Array.isArray(r.entries)) fetched.push(...r.entries);
      }
      setEntries(fetched);
      setError(null);
    } catch (e: any) {
      setError(typeof e === 'string' ? e : (e?.message ?? 'failed to load join queue'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
    const id = setInterval(loadEntries, 5000);
    return () => clearInterval(id);
  }, [factoryInstanceIdHex]);

  const handleApprove = async (e: JoinEntry) => {
    setBusyClient(e.client_pubkey_hex);
    try {
      await FactoriesService.approveJoinQueued(e.factory_instance_id_hex, e.client_pubkey_hex);
      await loadEntries();
    } catch (err: any) {
      setError(`approve failed: ${err?.message ?? err}`);
    } finally {
      setBusyClient(null);
    }
  };

  const handleRefuseSubmit = async () => {
    if (!refuseTarget) return;
    setBusyClient(refuseTarget.client_pubkey_hex);
    try {
      await FactoriesService.refuseJoinQueued(
        refuseTarget.factory_instance_id_hex,
        refuseTarget.client_pubkey_hex,
        refuseReason.trim() || undefined,
      );
      setRefuseTarget(null);
      setRefuseReason('');
      await loadEntries();
    } catch (err: any) {
      setError(`refuse failed: ${err?.message ?? err}`);
    } finally {
      setBusyClient(null);
    }
  };

  const pendingCount = useMemo(() => entries.filter(e => e.status === 0).length, [entries]);
  const sortedEntries = useMemo(() => {
    /* Pending first (status=0), then by received_at_block desc */
    return [...entries].sort((a, b) => {
      if (a.status === 0 && b.status !== 0) return -1;
      if (b.status === 0 && a.status !== 0) return 1;
      return b.received_at_block - a.received_at_block;
    });
  }, [entries]);

  return (
    <Card className='mb-3' data-testid='join-requests-card'>
      <Card.Body>
        <Card.Title className='d-flex align-items-center' style={{ fontSize: '1rem' }}>
          <span>Join requests</span>
          {pendingCount > 0 && (
            <Badge bg='warning' text='dark' className='ms-2'>
              {pendingCount} pending review
            </Badge>
          )}
        </Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
          Clients who have sent <code>factory-join-request</code> to this factory. Approve to include in the next rotation, or refuse with an optional reason.
        </Card.Subtitle>

        {error && (
          <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <div className='text-center py-2'>
            <Spinner animation='border' size='sm' />
            <span className='ms-2 text-muted'>Loading queue…</span>
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className='text-muted text-center py-3' style={{ fontSize: '0.9rem' }}>
            No join requests received for this factory.
          </div>
        ) : (
          <div className='table-responsive'>
          <Table size='sm' className='mb-0'>
            <thead>
              <tr style={{ fontSize: '0.8rem' }}>
                <th>Client</th>
                <th className='text-end'>Requested</th>
                <th className='text-end'>Received</th>
                <th>Status</th>
                <th className='text-end'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e) => {
                const badge = STATUS_LABEL[e.status] ?? { label: `Status ${e.status}`, bg: 'secondary', text: 'light' as BadgeTextColor };
                const age = currentBlock > 0 ? currentBlock - e.received_at_block : 0;
                const isBusy = busyClient === e.client_pubkey_hex;
                return (
                  <tr key={`${e.factory_instance_id_hex}-${e.client_pubkey_hex}`} style={{ fontSize: '0.85rem' }}>
                    <td title={e.client_pubkey_hex}>
                      <code>{short(e.client_pubkey_hex, 12)}</code>
                    </td>
                    <td className='text-end'>{Number(e.contribution_sats).toLocaleString()} sats</td>
                    <td className='text-end text-muted' title={`block ${e.received_at_block}`}>
                      {age} blk ago
                    </td>
                    <td>
                      <Badge bg={badge.bg} text={badge.text}>{badge.label}</Badge>
                      {e.reason && <div className='text-muted' style={{ fontSize: '0.75rem' }}>{e.reason}</div>}
                    </td>
                    <td className='text-end'>
                      {e.status === 0 || e.status === 3 ? (
                        <Button
                          size='sm'
                          variant='outline-success'
                          className='me-1'
                          disabled={isBusy}
                          onClick={() => handleApprove(e)}
                          data-testid={`approve-${e.client_pubkey_hex.slice(0, 8)}`}
                        >
                          {isBusy ? <Spinner animation='border' size='sm' /> : 'Approve'}
                        </Button>
                      ) : null}
                      {e.status === 0 || e.status === 1 ? (
                        <Button
                          size='sm'
                          variant='outline-danger'
                          disabled={isBusy}
                          onClick={() => setRefuseTarget(e)}
                          data-testid={`refuse-${e.client_pubkey_hex.slice(0, 8)}`}
                        >
                          Refuse
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          </div>
        )}
      </Card.Body>

      <Modal show={refuseTarget !== null} onHide={() => { setRefuseTarget(null); setRefuseReason(''); }} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>Refuse join request</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {refuseTarget && (
            <>
              <p className='mb-2' style={{ fontSize: '0.9rem' }}>
                Client: <code>{short(refuseTarget.client_pubkey_hex, 16)}</code><br />
                Requested capacity: <strong><SatsWithFiat value={Number(refuseTarget.contribution_sats)} /> sats</strong>
              </p>
              <Form.Group>
                <Form.Label>Reason (optional, visible to client on retry)</Form.Label>
                <Form.Control
                  as='textarea'
                  rows={2}
                  value={refuseReason}
                  onChange={(e) => setRefuseReason(e.target.value)}
                  placeholder='e.g. requested capacity below minimum, slots full'
                  data-testid='refuse-reason'
                />
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant='outline-secondary' onClick={() => { setRefuseTarget(null); setRefuseReason(''); }}>
            Cancel
          </Button>
          <Button variant='danger' onClick={handleRefuseSubmit} data-testid='refuse-confirm'>
            Refuse
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}

export default JoinRequestsCard;
