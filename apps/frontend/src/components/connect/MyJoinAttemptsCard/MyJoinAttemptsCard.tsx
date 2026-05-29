import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Badge, Button, Spinner, Alert } from 'react-bootstrap';
import { FactoriesService } from '../../../services/http.service';
import logger from '../../../services/logger.service';

/**
 * Task #152: surface the client's outgoing factory-join-request attempts
 * + current status. Powered by the plugin's client-list-outgoing-joins RPC
 * (added in PR #77). Renders on the Connect page so users can see what
 * happened to invites they sent without having to grep CLN logs.
 */

type OutgoingJoin = {
  instance_id: string;
  lsp_node_id: string;
  request_id: string;
  contribution_sats: number;
  sent_at_block: number;
  expected_signing_block: number;
  updated_at_block: number;
  status: string;
  status_code: number;
  reason?: string;
};

const truncate = (s: string, head = 8, tail = 4) =>
  !s || s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

const statusBadgeVariant = (status: string): string => {
  switch (status) {
    case 'sent':
    case 'queued':
    case 'accepted':
      return 'warning';
    case 'signed':
      return 'success';
    case 'rejected':
    case 'cancelled':
    case 'timeout':
      return 'danger';
    case 'already_member':
      return 'info';
    default:
      return 'secondary';
  }
};

const statusLabel = (status: string): string => {
  switch (status) {
    case 'sent': return 'Sent';
    case 'queued': return 'Queued';
    case 'accepted': return 'Accepted';
    case 'signed': return 'Signed';
    case 'rejected': return 'Rejected';
    case 'cancelled': return 'Cancelled';
    case 'timeout': return 'Timed out';
    case 'already_member': return 'Already in';
    default: return status;
  }
};

const formatSats = (n: number): string =>
  typeof n === 'number' ? n.toLocaleString() : '—';

const MyJoinAttemptsCard = () => {
  const [loading, setLoading] = useState(false);
  const [joins, setJoins] = useState<OutgoingJoin[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchJoins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await FactoriesService.listOutgoingJoins();
      setJoins(Array.isArray(result?.joins) ? result.joins : []);
    } catch (err: any) {
      const msg = err?.message || String(err);
      // The RPC only exists post #77 deploy. Suppress the noisy "method not
      // found" until the plugin upgrade rolls out.
      if (/method not found|unknown.*method|client-list-outgoing-joins/i.test(msg)) {
        setError('Plugin does not expose client-list-outgoing-joins yet '
          + '(deploy task #152 plugin half / PR #77 to enable).');
      } else {
        setError(msg);
      }
      logger.warn('listOutgoingJoins failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJoins();
  }, [fetchJoins]);

  return (
    <Card className='mt-3' data-testid='my-join-attempts-card'>
      <Card.Header className='d-flex justify-content-between align-items-center'>
        <span className='fw-bold'>My join attempts</span>
        <Button
          variant='link'
          size='sm'
          className='p-0 text-decoration-none'
          onClick={fetchJoins}
          disabled={loading}
          data-testid='my-join-attempts-refresh'
        >
          {loading ? <Spinner animation='border' size='sm' /> : 'Refresh'}
        </Button>
      </Card.Header>
      <Card.Body className='p-0'>
        {error && (
          <Alert variant='warning' className='m-2 py-2 fs-8 mb-0'>
            {error}
          </Alert>
        )}
        {!error && joins.length === 0 && !loading && (
          <div className='text-light fs-8 text-center py-3' data-testid='my-join-attempts-empty'>
            No outgoing join attempts from this node yet.
          </div>
        )}
        {!error && joins.length > 0 && (
          <Table size='sm' className='mb-0' striped>
            <thead style={{ fontSize: '0.78rem' }}>
              <tr>
                <th>Factory</th>
                <th>LSP</th>
                <th className='text-end'>Requested (sat)</th>
                <th>Sent at</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody style={{ fontSize: '0.8rem' }}>
              {joins.map((j, idx) => (
                <tr key={`${j.lsp_node_id}-${j.request_id}-${idx}`}>
                  <td><code>{truncate(j.instance_id, 10, 4)}</code></td>
                  <td><code>{truncate(j.lsp_node_id, 8, 4)}</code></td>
                  <td className='text-end'>{formatSats(j.contribution_sats)}</td>
                  <td>{j.sent_at_block || '—'}</td>
                  <td>
                    <Badge bg={statusBadgeVariant(j.status)}>{statusLabel(j.status)}</Badge>
                    {j.reason && (
                      <div className='text-light fs-8 mt-1' style={{ maxWidth: '14rem', whiteSpace: 'normal' }}>
                        {j.reason}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
};

export default MyJoinAttemptsCard;
