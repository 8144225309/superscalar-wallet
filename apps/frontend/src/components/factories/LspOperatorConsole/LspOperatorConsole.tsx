import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Table, Button, Badge, Spinner, Alert, Form, Modal } from 'react-bootstrap';
import { useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { selectFactoryList } from '../../../store/factoriesSelectors';
import { Factory } from '../../../types/factories.type';
import { FactoriesService } from '../../../services/http.service';
import SatsWithFiat from '../../shared/SatsWithFiat/SatsWithFiat';

/**
 * LSP Operator Console — task #82.
 *
 * What it renders
 *   A single review surface that aggregates `lsp_join_queue` rows
 *   across every factory where this node is LSP. Operators don't have
 *   to bounce between FactoryDetail pages to handle pending joins
 *   one at a time.
 *
 * Key state
 *   - `entries`: in-memory list of join-queue rows, polled from the
 *     plugin every 7s
 *   - `statusFilter`: which lifecycle bucket to display
 *   - `selected`: rows currently checked for bulk Approve/Refuse
 *     (R3.2 shipped bulk actions)
 *   - `actionInFlight`: true while any row action is pending —
 *     suppresses the 7s poll to avoid fighting the operator's click
 *     (R1.5 polish)
 *
 * Side effects
 *   - Plugin RPC calls: wallet-list-join-queue-by-status (poll),
 *     wallet-approve-join-queued, wallet-refuse-join-queued
 *   - On approve/refuse: refetches the list and clears selection
 *   - Bulk approve fans out sequentially to avoid swamping the plugin;
 *     bulk refuse shares one operator-supplied reason across all rows
 *
 * Props contract
 *   None — reads factory list from Redux to determine which factories
 *   to query. Caller mounts it inside the operator-only routes.
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
  status: number; /* 0 QUEUED, 1 ACCEPTED, 2 SIGNED, 3 REJECTED, 4 CANCELLED, 5 ALREADY_MEMBER */
  reason: string | null;
};

/* Bootstrap Badge's `text` prop is a fixed color-token union; using a
 * raw string would lose that constraint and the prior code worked
 * around it with `as any`. Constrain the field here so callers get
 * compile-time autocomplete and we drop the cast. */
type BadgeTextColor = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark' | 'muted' | 'white' | 'body' | 'black';

const STATUS_LABEL: Record<number, { label: string; bg: string; text: BadgeTextColor }> = {
  0: { label: 'Queued', bg: 'warning', text: 'dark' },
  1: { label: 'Accepted', bg: 'info', text: 'dark' },
  2: { label: 'Signed', bg: 'success', text: 'light' },
  3: { label: 'Rejected', bg: 'danger', text: 'light' },
  4: { label: 'Cancelled', bg: 'secondary', text: 'light' },
  5: { label: 'Already member', bg: 'secondary', text: 'light' },
};

const FILTER_TABS: Array<{ key: string; label: string; statuses: number[] }> = [
  { key: 'pending', label: 'Pending', statuses: [0] },
  { key: 'accepted', label: 'Accepted', statuses: [1] },
  { key: 'history', label: 'History', statuses: [2, 3, 4, 5] },
  { key: 'all', label: 'All', statuses: [0, 1, 2, 3, 4, 5] },
];

const short = (hex: string, head = 8, tail = 4) =>
  hex.length > head + tail + 1 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex;

type RowWithFactory = JoinEntry & { factory: Factory };

function LspOperatorConsole() {
  const factoryList = useSelector(selectFactoryList);
  const navigate = useNavigate();

  const lspFactories = useMemo<Factory[]>(
    () => (factoryList.factories || []).filter((f) => f.is_lsp),
    [factoryList.factories],
  );

  const [filter, setFilter] = useState<string>('pending');
  const [rows, setRows] = useState<RowWithFactory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refuseTarget, setRefuseTarget] = useState<RowWithFactory | null>(null);
  const [refuseReason, setRefuseReason] = useState('');
  /* Bulk-action selection — only Pending rows (status === 0) are
   * selectable. Refused/Cancelled/Signed/Already-member are terminal
   * from this view; bulk-approve only makes sense on queued items. */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRefuseOpen, setBulkRefuseOpen] = useState(false);
  const [bulkRefuseReason, setBulkRefuseReason] = useState('');

  const activeStatuses = useMemo(
    () => FILTER_TABS.find((t) => t.key === filter)?.statuses ?? [0],
    [filter],
  );

  const loadAll = async () => {
    try {
      const acc: RowWithFactory[] = [];
      for (const f of lspFactories) {
        for (const status of activeStatuses) {
          const r = await FactoriesService.listJoinQueueByStatus(f.instance_id, status);
          if (r && Array.isArray(r.entries)) {
            for (const entry of r.entries as JoinEntry[]) {
              acc.push({ ...entry, factory: f });
            }
          }
        }
      }
      // Pending first, then by received_at_block desc
      acc.sort((a, b) => {
        if (a.status === 0 && b.status !== 0) return -1;
        if (b.status === 0 && a.status !== 0) return 1;
        return b.received_at_block - a.received_at_block;
      });
      setRows(acc);
      setError(null);
    } catch (e: any) {
      setError(typeof e === 'string' ? e : e?.message ?? 'failed to load join queue');
    } finally {
      setLoading(false);
    }
  };

  /* Polish #2.2: pause auto-refresh when the user is mid-interaction so the
   * 7s poll doesn't fight Approve/Refuse clicks (which would overwrite the
   * row state the user just acted on with a stale read).
   *
   * Paused when: a row action is in flight (busyKey set) OR the Refuse
   * modal is open (refuseTarget set). Resumes automatically as soon as
   * both clear.
   *
   * Split into two effects so changing `paused` doesn't re-fire an
   * immediate loadAll() — that would re-introduce the same race the
   * pause is meant to fix. The immediate load runs on mount + when the
   * relevant inputs change; the polling interval lives in its own effect
   * and reads `paused` via a ref so changing it doesn't tear down the
   * interval (and doesn't trigger an immediate poll). */
  const pausedRef = useRef(false);
  pausedRef.current = busyKey !== null || refuseTarget !== null;
  useEffect(() => {
    loadAll();
  }, [lspFactories, filter]);
  useEffect(() => {
    const id = setInterval(() => {
      if (!pausedRef.current) loadAll();
    }, 7000);
    return () => clearInterval(id);
  }, [lspFactories, filter]);

  const rowKey = (r: { factory_instance_id_hex: string; client_pubkey_hex: string }) =>
    `${r.factory_instance_id_hex}-${r.client_pubkey_hex}`;

  /* Pending rows currently visible — what bulk-select will operate on.
   * Recomputed when filter / rows change so the selection set never
   * holds keys for rows no longer in the table. */
  const selectablePending = useMemo(
    () => rows.filter((r) => r.status === 0),
    [rows],
  );
  const allSelected =
    selectablePending.length > 0 &&
    selectablePending.every((r) => selectedKeys.has(rowKey(r)));
  const someSelected =
    !allSelected && selectablePending.some((r) => selectedKeys.has(rowKey(r)));

  const toggleSelect = (r: RowWithFactory) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = rowKey(r);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(selectablePending.map(rowKey)));
    }
  };

  /* Fan out approve / refuse across the currently-selected rows. We run
   * them sequentially (not Promise.all) because the plugin's join queue
   * lock is per-factory; parallel calls against the same factory would
   * race anyway. Sequential keeps the error surface readable. */
  const handleBulkApprove = async () => {
    const targets = selectablePending.filter((r) => selectedKeys.has(rowKey(r)));
    if (targets.length === 0) return;
    setBulkBusy(true);
    let failures = 0;
    for (const r of targets) {
      try {
        await FactoriesService.approveJoinQueued(r.factory_instance_id_hex, r.client_pubkey_hex);
      } catch {
        failures++;
      }
    }
    setSelectedKeys(new Set());
    setBulkBusy(false);
    if (failures > 0) setError(`Bulk approve: ${failures}/${targets.length} failed`);
    await loadAll();
  };
  const handleBulkRefuse = async () => {
    const targets = selectablePending.filter((r) => selectedKeys.has(rowKey(r)));
    if (targets.length === 0) return;
    setBulkBusy(true);
    let failures = 0;
    for (const r of targets) {
      try {
        await FactoriesService.refuseJoinQueued(
          r.factory_instance_id_hex,
          r.client_pubkey_hex,
          bulkRefuseReason.trim() || undefined,
        );
      } catch {
        failures++;
      }
    }
    setSelectedKeys(new Set());
    setBulkRefuseOpen(false);
    setBulkRefuseReason('');
    setBulkBusy(false);
    if (failures > 0) setError(`Bulk refuse: ${failures}/${targets.length} failed`);
    await loadAll();
  };

  const handleApprove = async (r: RowWithFactory) => {
    const key = `${r.factory_instance_id_hex}-${r.client_pubkey_hex}`;
    setBusyKey(key);
    try {
      await FactoriesService.approveJoinQueued(r.factory_instance_id_hex, r.client_pubkey_hex);
      await loadAll();
    } catch (e: any) {
      setError(`approve failed: ${e?.message ?? e}`);
    } finally {
      setBusyKey(null);
    }
  };

  const handleRefuseSubmit = async () => {
    if (!refuseTarget) return;
    const key = `${refuseTarget.factory_instance_id_hex}-${refuseTarget.client_pubkey_hex}`;
    setBusyKey(key);
    try {
      await FactoriesService.refuseJoinQueued(
        refuseTarget.factory_instance_id_hex,
        refuseTarget.client_pubkey_hex,
        refuseReason.trim() || undefined,
      );
      setRefuseTarget(null);
      setRefuseReason('');
      await loadAll();
    } catch (e: any) {
      setError(`refuse failed: ${e?.message ?? e}`);
    } finally {
      setBusyKey(null);
    }
  };

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 0).length, [rows]);
  const acceptedCount = useMemo(() => rows.filter((r) => r.status === 1).length, [rows]);
  const factoriesWithPending = useMemo(() => {
    const seen = new Set<string>();
    rows.filter((r) => r.status === 0).forEach((r) => seen.add(r.factory_instance_id_hex));
    return seen.size;
  }, [rows]);

  if (lspFactories.length === 0) {
    return (
      <Card className='mb-3' data-testid='lsp-operator-console-empty'>
        <Card.Body>
          <Card.Title style={{ fontSize: '1rem' }}>LSP operator console</Card.Title>
          <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
            This node has no LSP-side factories yet. Once you create a factory and accept joins,
            pending requests will surface here for unified review.
          </Card.Subtitle>
          <div className='text-muted text-center py-3' style={{ fontSize: '0.9rem' }}>
            No factories where this node is LSP.
          </div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className='mb-3' data-testid='lsp-operator-console'>
      <Card.Body>
        <Card.Title className='d-flex align-items-center justify-content-between flex-wrap' style={{ fontSize: '1rem' }}>
          <div className='d-flex align-items-center'>
            <span>LSP operator console</span>
            {pendingCount > 0 && (
              <Badge bg='warning' text='dark' className='ms-2' data-testid='console-pending-badge'>
                {pendingCount} pending in {factoriesWithPending} factor{factoriesWithPending === 1 ? 'y' : 'ies'}
              </Badge>
            )}
            {acceptedCount > 0 && (
              <Badge bg='info' text='dark' className='ms-2'>
                {acceptedCount} accepted awaiting trigger
              </Badge>
            )}
            {(busyKey !== null || refuseTarget !== null) && (
              <Badge
                bg='secondary'
                className='ms-2'
                style={{ fontSize: '0.7rem', fontWeight: 400 }}
                data-testid='console-poll-paused'
                title='Auto-refresh paused while you work this row. Resumes once you finish.'
              >
                refresh paused
              </Badge>
            )}
          </div>
          <div className='btn-group btn-group-sm' role='group' aria-label='filter'>
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                type='button'
                className={
                  'btn ' + (filter === t.key ? 'btn-primary' : 'btn-outline-secondary')
                }
                onClick={() => setFilter(t.key)}
                data-testid={`console-filter-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Card.Title>
        <Card.Subtitle className='text-muted mb-3' style={{ fontSize: '0.85rem' }}>
          Every <code>factory-join-request</code> received across all {lspFactories.length} LSP-side factor{lspFactories.length === 1 ? 'y' : 'ies'} on this node.
          Approve to include in the next ceremony; refuse with an optional reason that the client sees on retry.
        </Card.Subtitle>

        {error && (
          <Alert variant='warning' className='py-2 mb-3' style={{ fontSize: '0.85rem' }}>
            {error}
          </Alert>
        )}

        {/* Bulk action bar — only when 1+ pending rows are selected. */}
        {selectedKeys.size > 0 && (
          <div
            className='d-flex align-items-center justify-content-between p-2 mb-2 rounded'
            style={{ fontSize: '0.85rem', backgroundColor: 'rgba(13, 110, 253, 0.08)' }}
            data-testid='bulk-action-bar'
          >
            <span>
              <strong>{selectedKeys.size}</strong> pending row{selectedKeys.size === 1 ? '' : 's'} selected
            </span>
            <div className='d-flex gap-2'>
              <Button
                size='sm'
                variant='outline-secondary'
                onClick={() => setSelectedKeys(new Set())}
                disabled={bulkBusy}
                data-testid='bulk-clear'
              >
                Clear
              </Button>
              <Button
                size='sm'
                variant='success'
                onClick={handleBulkApprove}
                disabled={bulkBusy}
                data-testid='bulk-approve'
              >
                {bulkBusy ? <Spinner animation='border' size='sm' /> : `Approve ${selectedKeys.size}`}
              </Button>
              <Button
                size='sm'
                variant='danger'
                onClick={() => setBulkRefuseOpen(true)}
                disabled={bulkBusy}
                data-testid='bulk-refuse'
              >
                Refuse {selectedKeys.size}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className='text-center py-3'>
            <Spinner animation='border' size='sm' />
            <span className='ms-2 text-muted'>Loading queues…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className='text-muted text-center py-3' style={{ fontSize: '0.9rem' }}>
            No {filter === 'all' ? '' : filter + ' '}join entries across your factories.
          </div>
        ) : (
          <div className='table-responsive'>
            <Table size='sm' className='mb-0'>
              <thead>
                <tr style={{ fontSize: '0.8rem' }}>
                  <th style={{ width: '32px' }}>
                    {selectablePending.length > 0 && (
                      <Form.Check
                        type='checkbox'
                        checked={allSelected}
                        ref={(el: HTMLInputElement | null) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={toggleSelectAll}
                        aria-label='Select all pending'
                        data-testid='bulk-select-all'
                      />
                    )}
                  </th>
                  <th>Factory</th>
                  <th>Client</th>
                  <th className='text-end'>Requested</th>
                  <th className='text-end'>Received</th>
                  <th>Status</th>
                  <th className='text-end'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const badge =
                    STATUS_LABEL[r.status] ?? { label: `Status ${r.status}`, bg: 'secondary', text: 'light' as BadgeTextColor };
                  const key = `${r.factory_instance_id_hex}-${r.client_pubkey_hex}`;
                  const isBusy = busyKey === key;
                  const currentBlock = r.factory.creation_block + 0; // we don't have blockheight here; rely on received_at_block raw
                  const age = currentBlock > 0 ? Math.max(0, currentBlock - r.received_at_block) : 0;
                  const selectable = r.status === 0;
                  const isSelected = selectedKeys.has(key);
                  return (
                    <tr key={key} style={{ fontSize: '0.85rem' }} className={isSelected ? 'table-active' : undefined}>
                      <td>
                        {selectable && (
                          <Form.Check
                            type='checkbox'
                            checked={isSelected}
                            onChange={() => toggleSelect(r)}
                            aria-label={`Select ${r.client_pubkey_hex.slice(0, 8)}`}
                            data-testid={`bulk-select-${r.client_pubkey_hex.slice(0, 8)}`}
                          />
                        )}
                      </td>
                      <td>
                        <Link
                          to={`/factories/${r.factory.instance_id}`}
                          className='text-decoration-none'
                          data-testid={`console-factory-link-${r.factory.instance_id.slice(0, 8)}`}
                          title={r.factory.instance_id}
                        >
                          <code>{short(r.factory.instance_id, 8, 4)}</code>
                        </Link>
                      </td>
                      <td title={r.client_pubkey_hex}>
                        <code>{short(r.client_pubkey_hex, 12, 4)}</code>
                      </td>
                      <td className='text-end'>
                        <SatsWithFiat value={Number(r.contribution_sats)} />
                      </td>
                      <td className='text-end text-muted' title={`block ${r.received_at_block}`}>
                        block {r.received_at_block}
                        {age > 0 && <div style={{ fontSize: '0.7rem' }}>{age} blk ago</div>}
                      </td>
                      <td>
                        <Badge bg={badge.bg} text={badge.text}>
                          {badge.label}
                        </Badge>
                        {r.reason && (
                          <div className='text-muted' style={{ fontSize: '0.75rem' }}>
                            {r.reason}
                          </div>
                        )}
                      </td>
                      <td className='text-end'>
                        {(r.status === 0 || r.status === 3) && (
                          <Button
                            size='sm'
                            variant='outline-success'
                            className='me-1'
                            disabled={isBusy}
                            onClick={() => handleApprove(r)}
                            data-testid={`console-approve-${r.client_pubkey_hex.slice(0, 8)}`}
                          >
                            {isBusy ? <Spinner animation='border' size='sm' /> : 'Approve'}
                          </Button>
                        )}
                        {(r.status === 0 || r.status === 1) && (
                          <Button
                            size='sm'
                            variant='outline-danger'
                            disabled={isBusy}
                            onClick={() => setRefuseTarget(r)}
                            data-testid={`console-refuse-${r.client_pubkey_hex.slice(0, 8)}`}
                          >
                            Refuse
                          </Button>
                        )}
                        <Button
                          size='sm'
                          variant='outline-secondary'
                          className='ms-1'
                          onClick={() => navigate(`/factories/${r.factory.instance_id}`)}
                          title='Open factory detail'
                        >
                          Open ›
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card.Body>

      <Modal
        show={refuseTarget !== null}
        onHide={() => {
          setRefuseTarget(null);
          setRefuseReason('');
        }}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>Refuse join request</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {refuseTarget && (
            <>
              <p className='mb-2' style={{ fontSize: '0.9rem' }}>
                Factory: <code>{short(refuseTarget.factory.instance_id, 10, 4)}</code>
                <br />
                Client: <code>{short(refuseTarget.client_pubkey_hex, 16, 6)}</code>
                <br />
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
                  data-testid='console-refuse-reason'
                />
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant='outline-secondary'
            onClick={() => {
              setRefuseTarget(null);
              setRefuseReason('');
            }}
          >
            Cancel
          </Button>
          <Button variant='danger' onClick={handleRefuseSubmit} data-testid='console-refuse-confirm'>
            Refuse
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={bulkRefuseOpen}
        onHide={() => {
          setBulkRefuseOpen(false);
          setBulkRefuseReason('');
        }}
        centered
        data-testid='bulk-refuse-modal'
      >
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>
            Refuse {selectedKeys.size} join request{selectedKeys.size === 1 ? '' : 's'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className='mb-2' style={{ fontSize: '0.9rem' }}>
            Refusing all selected pending joins. Each client sees the same reason on retry.
          </p>
          <Form.Group>
            <Form.Label>Reason (optional, applied to all)</Form.Label>
            <Form.Control
              as='textarea'
              rows={2}
              value={bulkRefuseReason}
              onChange={(e) => setBulkRefuseReason(e.target.value)}
              placeholder='e.g. capacity full for this epoch'
              data-testid='bulk-refuse-reason'
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant='outline-secondary'
            onClick={() => {
              setBulkRefuseOpen(false);
              setBulkRefuseReason('');
            }}
            disabled={bulkBusy}
          >
            Cancel
          </Button>
          <Button
            variant='danger'
            onClick={handleBulkRefuse}
            disabled={bulkBusy}
            data-testid='bulk-refuse-confirm'
          >
            {bulkBusy ? <Spinner animation='border' size='sm' /> : `Refuse ${selectedKeys.size}`}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}

export default LspOperatorConsole;
