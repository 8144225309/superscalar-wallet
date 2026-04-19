import './ConnectList.scss';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PerfectScrollbar from 'react-perfect-scrollbar';
import {
  Card,
  Row,
  Col,
  ListGroup,
  OverlayTrigger,
  Tooltip,
  Form,
  Button,
  Spinner,
} from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';
import { selectUIConfigUnit } from '../../../store/rootSelectors';
import { Units, BTC_SATS } from '../../../utilities/constants';
import { CoordinationFactory, SAMPLE_COORDINATION_FACTORIES } from '../../../types/coordination.type';
import { copyTextToClipboard } from '../../../utilities/data-formatters';
import GossipPill from '../GossipPill/GossipPill';
import {
  CoordinatorNetwork,
  Vouch,
  VouchTier,
} from '../../../types/rendezvous.type';
import {
  selectMergedVouchList,
  selectRendezvousSettings,
  selectVouchErrors,
  selectVouchesLoading,
  makeSelectActiveCoordinators,
  selectEnabledRelays,
} from '../../../store/rendezvousSelectors';
import {
  setSettings,
  setSettingsError,
  setSettingsLoading,
  setVouchList,
  setVouchListLoading,
} from '../../../store/rendezvousSlice';
import rendezvousReducer from '../../../store/rendezvousSlice';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import { selectActiveProfile } from '../../../store/nodesSelectors';
import { fetchVouches } from '../../../services/nostr.service';
import { RendezvousService } from '../../../services/http.service';

type RowSource = 'sample' | VouchTier;
type SortKey = 'factory' | 'capacity' | 'minChannel' | 'opens';
type SortDir = 'asc' | 'desc';
type JoinStatus = 'requested' | 'confirmed';

interface FactoryRow {
  id: string;
  pubkey: string;
  alias: string;
  capacitySats: number | null;
  minChannelSats: number | null;
  /** 0 = open now, >0 = blocks-until-rotation, null = unknown (real vouch awaiting LSP browse) */
  opensInBlocks: number | null;
  /** sample factories carry forming/rotating; real vouches start as 'pending' until LSP browse fills them */
  status: 'forming' | 'rotating' | 'pending';
  isSelf: boolean;
  nBreachEpochs: number;
  source: RowSource;
  /** vouch fields (only on real vouches) */
  expiresAt?: number;
  lnAddresses?: string[];
  coordinatorNpub?: string;
  verifiedAt?: number;
}

const blocksToApproxDays = (blocks: number): string => {
  const days = Math.round((blocks * 10) / 60 / 24);
  if (days < 1) return '<1d';
  return `~${days}d`;
};

function clnNetworkToCoordKey(net: string | undefined): CoordinatorNetwork | null {
  if (!net) return null;
  const lower = net.toLowerCase();
  if (lower === 'bitcoin' || lower === 'mainnet') return 'bitcoin';
  if (lower === 'signet') return 'signet';
  if (lower === 'testnet4') return 'testnet4';
  return null;
}

function compareNullable(a: number | null, b: number | null, dir: SortDir): number {
  // Nulls always sort to the bottom regardless of direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function compareString(a: string, b: string, dir: SortDir): number {
  return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

const SourceBadge = ({ src }: { src: RowSource }) => {
  const map: Record<RowSource, { bg: string; label: string; tip: string }> = {
    sample:  { bg: 'dark',      label: 'sample',  tip: 'Hardcoded demo data — not a real LSP.' },
    channel: { bg: 'success',   label: 'channel', tip: 'Chain-anchored: LSP proved control of an LN node with ≥1 announced channel.' },
    utxo:    { bg: 'info',      label: 'utxo',    tip: 'Chain-anchored: LSP proved control of an unspent on-chain UTXO.' },
    peer:    { bg: 'secondary', label: 'peer',    tip: 'No chain anchor: BOLT-8 handshake only. Lower trust.' },
  };
  const { bg, label, tip } = map[src];
  return (
    <OverlayTrigger placement='auto' overlay={<Tooltip>{tip}</Tooltip>}>
      <span className={`badge bg-${bg} text-uppercase`}>{label}</span>
    </OverlayTrigger>
  );
};

const ConnectList = () => {
  useInjectReducer('rendezvous', rendezvousReducer);
  const dispatch = useDispatch();
  const uiConfigUnit = useSelector(selectUIConfigUnit);

  const settings = useSelector(selectRendezvousSettings);
  const vouches = useSelector(selectMergedVouchList);
  const isVouchLoading = useSelector(selectVouchesLoading);
  const vouchErrors = useSelector(selectVouchErrors);
  const activeProfile = useSelector(selectActiveProfile);
  const enabledRelays = useSelector(selectEnabledRelays);

  const network = clnNetworkToCoordKey(activeProfile?.network);
  const selectActiveCoords = useMemo(
    () => makeSelectActiveCoordinators(network ?? 'signet'),
    [network],
  );
  const activeCoordinators = useSelector(selectActiveCoords);

  const [showSample, setShowSample] = useState(false);
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinStatus>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('opens');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const lastFetchKeyRef = useRef<string>('');

  // Lazy-load settings (settings panel may also load these — first one wins)
  useEffect(() => {
    if (settings) return;
    let cancelled = false;
    dispatch(setSettingsLoading(true));
    RendezvousService.fetchSettings()
      .then(s => { if (!cancelled) dispatch(setSettings(s)); })
      .catch(err => {
        if (!cancelled) dispatch(setSettingsError(typeof err === 'string' ? err : err?.message || 'Load failed'));
      });
    return () => { cancelled = true; };
  }, [settings, dispatch]);

  const refreshVouches = useCallback(async () => {
    if (!settings || !network || activeCoordinators.length === 0) return;
    const includePeer = !!settings.showPeerTier?.[network];
    dispatch(setVouchListLoading(true));
    try {
      const result = await fetchVouches(activeCoordinators, enabledRelays, {
        tierCaps: settings.tierCaps,
        maxEntries: settings.maxEntries,
        includePeer,
      });
      dispatch(setVouchList({
        vouches: result.vouches,
        byCoordinator: result.byCoordinator,
        errors: result.errors,
      }));
    } catch (err: any) {
      dispatch(setVouchList({
        vouches: [],
        byCoordinator: {},
        errors: { _global: typeof err === 'string' ? err : err?.message || 'Fetch failed' },
      }));
    }
  }, [settings, network, activeCoordinators, enabledRelays, dispatch]);

  // Initial / on-input-change vouch fetch (only in real mode).
  useEffect(() => {
    if (showSample) return;
    if (!settings || !network || activeCoordinators.length === 0) return;
    const key = JSON.stringify({
      net: network,
      coords: activeCoordinators.map(c => c.npub),
      relays: enabledRelays,
      caps: settings.tierCaps,
      max: settings.maxEntries,
      peer: settings.showPeerTier?.[network],
    });
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;
    refreshVouches();
  }, [showSample, settings, network, activeCoordinators, enabledRelays, refreshVouches]);

  // Periodic auto-refresh — gated on settings.vouchAutoRefresh (default off).
  useEffect(() => {
    if (showSample) return;
    if (!settings?.vouchAutoRefresh) return;
    const intervalMs = Math.max(1, settings.vouchRefreshMin) * 60_000;
    const id = setInterval(() => { refreshVouches(); }, intervalMs);
    return () => clearInterval(id);
  }, [showSample, settings, refreshVouches]);

  const activePubkey = activeProfile?.pubkey;

  // ---- build the unified row list -----
  const rows: FactoryRow[] = useMemo(() => {
    if (showSample) {
      // Sample mode: project hardcoded factories into the unified shape, plus inject
      // a synthetic "self" row using the active node's pubkey so demos can show what
      // self looks like without depending on real Nostr advertisements.
      const sampleRows: FactoryRow[] = SAMPLE_COORDINATION_FACTORIES.map((f: CoordinationFactory) => ({
        id: f.id,
        pubkey: f.lsp_pubkey,
        alias: f.lsp_alias,
        capacitySats: f.total_capacity_sats,
        minChannelSats: f.min_channel_sats,
        opensInBlocks: f.status === 'forming' ? 0 : f.blocks_until_rotation,
        status: f.status,
        isSelf: !!activePubkey && f.lsp_pubkey === activePubkey,
        nBreachEpochs: f.n_breach_epochs,
        source: 'sample',
      }));
      if (activePubkey && !sampleRows.some(r => r.isSelf)) {
        sampleRows.unshift({
          id: 'sample-self',
          pubkey: activePubkey,
          alias: activeProfile?.alias || activeProfile?.label || 'Your Node',
          capacitySats: 7_500_000,
          minChannelSats: 250_000,
          opensInBlocks: 0,
          status: 'forming',
          isSelf: true,
          nBreachEpochs: 0,
          source: 'sample',
        });
      }
      return sampleRows;
    }

    // Real mode: vouches arrive blank-stat. The plugin-side LN browse fill (next PR)
    // populates capacity / min channel / opens-in per row asynchronously.
    return vouches.map((v: Vouch) => ({
      id: `${v.coordinator}:${v.ln_node_id}`,
      pubkey: v.ln_node_id,
      alias: v.ln_node_id.slice(0, 16) + '…' + v.ln_node_id.slice(-6),
      capacitySats: null,
      minChannelSats: null,
      opensInBlocks: null,
      status: 'pending',
      isSelf: !!activePubkey && v.ln_node_id === activePubkey,
      nBreachEpochs: 0,
      source: v.tier,
      expiresAt: v.expires_at,
      lnAddresses: v.ln_addresses,
      coordinatorNpub: v.coordinator,
      verifiedAt: v.verified_at,
    }));
  }, [showSample, vouches, activePubkey, activeProfile?.alias, activeProfile?.label]);

  // ---- sort: self pinned to top regardless ----
  const sortedRows = useMemo(() => {
    const dir = sortDir;
    const cmp = (a: FactoryRow, b: FactoryRow): number => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      switch (sortKey) {
        case 'factory':    return compareString(a.alias, b.alias, dir);
        case 'capacity':   return compareNullable(a.capacitySats, b.capacitySats, dir);
        case 'minChannel': return compareNullable(a.minChannelSats, b.minChannelSats, dir);
        case 'opens':      return compareNullable(a.opensInBlocks, b.opensInBlocks, dir);
      }
    };
    return [...rows].sort(cmp);
  }, [rows, sortKey, sortDir]);

  const formatSats = useCallback((sats: number | null): string => {
    if (sats === null) return '—';
    if (uiConfigUnit === Units.BTC) return `${(sats / BTC_SATS).toFixed(6)} BTC`;
    return `${sats.toLocaleString()} sats`;
  }, [uiConfigUnit]);

  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'factory' ? 'asc' : 'asc');
    }
  };

  const handleRowClick = (id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  };

  const selected = selectedId ? sortedRows.find(r => r.id === selectedId) || null : null;
  const selectedIsSelf = !!selected?.isSelf;
  const selectedRequest = selected ? joinRequests[selected.id] : undefined;

  const handleJoin = () => {
    if (!selected || selectedIsSelf || selectedRequest) return;
    setJoinRequests(prev => ({ ...prev, [selected.id]: 'requested' }));
  };

  const handleCancel = () => {
    if (!selected || selectedRequest !== 'requested') return;
    setJoinRequests(prev => {
      const next = { ...prev };
      delete next[selected.id];
      return next;
    });
  };

  const canJoin = !!selected && !selectedIsSelf && !selectedRequest;
  const canCancel = !!selected && selectedRequest === 'requested';

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return <span className='sort-indicator inactive'>↕</span>;
    return <span className='sort-indicator'>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const errorEntries = !showSample ? Object.entries(vouchErrors).filter(([, msg]) => msg) : [];

  return (
    <Card className='h-100 d-flex align-items-stretch px-4 pt-4 pb-3' data-testid='connect-list'>
      <Card.Header className='px-1 pb-2 p-0'>
        <div className='d-flex justify-content-between align-items-center mb-2 gap-2 flex-wrap'>
          <span className='fs-18px fw-bold text-dark'>Open Factories</span>
          <div className='d-flex align-items-center gap-3 flex-wrap'>
            {!showSample && (
              <>
                {isVouchLoading && <Spinner size='sm' animation='border' />}
                <Button size='sm' variant='outline-primary' onClick={refreshVouches} disabled={isVouchLoading}>
                  Refresh
                </Button>
              </>
            )}
            <OverlayTrigger
              placement='auto'
              overlay={<Tooltip>Sample mode shows demo factories instead of live vouch data. Real and sample never mix.</Tooltip>}
            >
              <Form.Check
                type='switch'
                id='connect-sample-toggle'
                label={<span className='fs-7 text-light'>Sample data</span>}
                checked={showSample}
                onChange={(e) => setShowSample(e.target.checked)}
                data-testid='connect-sample-toggle'
              />
            </OverlayTrigger>
            <GossipPill />
          </div>
        </div>
      </Card.Header>

      <Card.Body className='py-0 px-1 channels-scroll-container'>
        {!showSample && !network && (
          <Row className='text-light fs-6 mt-3 mx-2 text-center'>
            Active node's network ({activeProfile?.network ?? 'unknown'}) is not covered by any
            configured coordinator. Switch to a signet, testnet4, or mainnet node to see vouches.
          </Row>
        )}
        {!showSample && network && activeCoordinators.length === 0 && (
          <Row className='text-light fs-6 mt-3 mx-2 text-center'>
            No coordinators enabled for {network}. Open Rendezvous settings below to enable one.
          </Row>
        )}
        {sortedRows.length === 0 && !isVouchLoading ? (
          <Row className='text-light fs-6 mt-3 h-100 align-items-center justify-content-center'>
            <Row className='text-center pb-4'>
              {showSample
                ? 'No sample factories.'
                : 'No vouches returned. Coordinator may have an empty list yet, or relays may be unreachable.'}
            </Row>
          </Row>
        ) : (
          <>
            <Row className='connect-col-headers text-light px-0 pt-2 pb-1 mx-0'>
              <Col xs={4} className='sortable' onClick={() => handleHeaderClick('factory')}>
                Factory {sortIndicator('factory')}
              </Col>
              <Col xs={3} className='sortable' onClick={() => handleHeaderClick('capacity')}>
                Capacity {sortIndicator('capacity')}
              </Col>
              <Col xs={2} className='sortable' onClick={() => handleHeaderClick('minChannel')}>
                Min Ch {sortIndicator('minChannel')}
              </Col>
              <Col xs={3} className='sortable' onClick={() => handleHeaderClick('opens')}>
                Opens {sortIndicator('opens')}
              </Col>
            </Row>
            <PerfectScrollbar>
              <ListGroup variant='flush' className='fs-7 pe-1'>
                {sortedRows.map((row) => {
                  const request = joinRequests[row.id];
                  const isSelected = selectedId === row.id;

                  return (
                    <ListGroup.Item
                      key={row.id}
                      className={`connect-list-item px-0 py-2 ${isSelected ? 'selected' : ''} ${row.isSelf ? 'is-self' : ''}`}
                      onClick={() => handleRowClick(row.id)}
                    >
                      <Row className='align-items-start mx-0'>
                        <Col xs={4} className='d-flex align-items-center gap-1 connect-name'>
                          {row.isSelf && (
                            <OverlayTrigger placement='auto' overlay={<Tooltip>This is your active node — listed so you can verify your own advertisement is visible. You can't join yourself.</Tooltip>}>
                              <span className='badge bg-warning text-dark connect-badge-md me-1'>self</span>
                            </OverlayTrigger>
                          )}
                          {row.nBreachEpochs > 0 && (
                            <OverlayTrigger placement='auto' overlay={<Tooltip>{row.nBreachEpochs} breach epoch(s) on record</Tooltip>}>
                              <span className='badge bg-danger connect-badge-md me-1'>! breach</span>
                            </OverlayTrigger>
                          )}
                          <span className='fw-bold text-dark text-truncate'>{row.alias}</span>
                          {request === 'requested' && (
                            <span className='badge bg-warning text-dark connect-badge-md ms-1'>⏳</span>
                          )}
                          {request === 'confirmed' && (
                            <span className='badge bg-success connect-badge-md ms-1'>✓</span>
                          )}
                        </Col>
                        <Col xs={3}>{formatSats(row.capacitySats)}</Col>
                        <Col xs={2}>{formatSats(row.minChannelSats)}</Col>
                        <Col xs={3}>
                          {row.opensInBlocks === null ? (
                            <span className='text-light'>—</span>
                          ) : row.opensInBlocks === 0 ? (
                            <span className='text-success fw-bold'>open now</span>
                          ) : (
                            <span>{blocksToApproxDays(row.opensInBlocks)}</span>
                          )}
                        </Col>
                      </Row>

                      {isSelected && (
                        <Row className='mt-2 mx-0 connect-detail'>
                          <Col xs={12}>
                            <div className='fs-7 mb-1'>
                              <span className='fw-semibold me-2'>Source:</span>
                              <SourceBadge src={row.source} />
                            </div>
                            <div className='fs-7 mb-1'>
                              <span className='fw-semibold'>Pubkey:</span>{' '}
                              <span
                                className='font-monospace cursor-pointer text-break'
                                onClick={(e) => { e.stopPropagation(); copyTextToClipboard(row.pubkey); }}
                                title='Click to copy'
                              >
                                {row.pubkey}
                              </span>
                            </div>
                            {row.lnAddresses && row.lnAddresses.length > 0 && (
                              <div className='fs-7 mb-1'>
                                <span className='fw-semibold'>Addresses:</span>{' '}
                                <span className='font-monospace'>{row.lnAddresses.join(', ')}</span>
                              </div>
                            )}
                            {row.expiresAt && (
                              <div className='fs-7 mb-1 text-light'>
                                Vouch expires {new Date(row.expiresAt * 1000).toLocaleString()}
                              </div>
                            )}
                            {row.verifiedAt && (
                              <div className='fs-7 mb-1 text-light'>
                                Verified {new Date(row.verifiedAt * 1000).toLocaleString()}
                              </div>
                            )}
                            {row.coordinatorNpub && (
                              <div className='fs-7 mb-1 text-light text-break'>
                                <span className='fw-semibold'>Coordinator:</span>{' '}
                                <span className='font-monospace'>{row.coordinatorNpub}</span>
                              </div>
                            )}
                            {row.source !== 'sample' && (row.capacitySats === null || row.opensInBlocks === null) && (
                              <div className='fs-7 mt-2 fst-italic text-light'>
                                Factory details (capacity / slots / open time) load when the wallet contacts this LSP over LN — coming with the next plugin RPC.
                              </div>
                            )}
                          </Col>
                        </Row>
                      )}
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>
              {showSample && (
                <div className='connect-disclaimer text-center mt-2 mb-1 px-2'>
                  Sample data — coordination server coming soon
                </div>
              )}
            </PerfectScrollbar>
          </>
        )}

        {errorEntries.length > 0 && (
          <div className='connect-vouch-errors mt-2 fs-7 text-danger px-1'>
            {errorEntries.map(([npub, msg]) => (
              <div key={npub} className='text-break'>
                <span className='font-monospace'>{npub === '_global' ? 'global' : npub}</span>{' '}— {msg}
              </div>
            ))}
          </div>
        )}
      </Card.Body>

      <Card.Footer className='d-flex justify-content-center align-items-center gap-2'>
        <button
          className='btn-rounded bg-primary btn-sm'
          onClick={handleJoin}
          disabled={!canJoin}
          title={selectedIsSelf ? "You can't join your own factory." : undefined}
        >
          {selectedIsSelf ? 'Join (self — blocked)' : 'Join Factory'}
        </button>
        <button
          className={`btn-rounded btn-sm ${canCancel ? 'bg-warning text-dark' : 'bg-secondary'}`}
          onClick={handleCancel}
          disabled={!canCancel}
        >
          Cancel Request
        </button>
      </Card.Footer>
    </Card>
  );
};

export default ConnectList;
