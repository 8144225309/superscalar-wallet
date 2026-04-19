import './VouchList.scss';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PerfectScrollbar from 'react-perfect-scrollbar';
import { Row, Col, ListGroup, OverlayTrigger, Tooltip, Button, Spinner, Badge } from 'react-bootstrap';
import { useDispatch, useSelector } from 'react-redux';
import {
  selectMergedVouchList,
  selectRendezvousSettings,
  selectVouchCounts,
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
import { copyTextToClipboard } from '../../../utilities/data-formatters';
import { CoordinatorNetwork, Vouch, VouchTier } from '../../../types/rendezvous.type';

type TierFilter = 'all' | VouchTier;

const TIER_LABEL: Record<VouchTier, string> = {
  channel: 'channel',
  utxo: 'utxo',
  peer: 'peer',
};

const TIER_BADGE_BG: Record<VouchTier, string> = {
  channel: 'success',
  utxo: 'info',
  peer: 'secondary',
};

const TIER_TOOLTIP: Record<VouchTier, string> = {
  channel: 'Chain-anchored: LSP proved control of an LN node with ≥1 announced channel.',
  utxo: 'Chain-anchored: LSP proved control of an unspent on-chain UTXO.',
  peer: 'No chain anchor: BOLT-8 handshake only. Lower trust, recommended off on mainnet.',
};

function shortPubkey(hex: string): string {
  return hex.slice(0, 10) + '…' + hex.slice(-6);
}

function formatExpiresIn(expiresAt: number): string {
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return 'expired';
  const days = Math.floor(secs / 86400);
  if (days >= 2) return `${days}d`;
  const hours = Math.floor(secs / 3600);
  if (hours >= 2) return `${hours}h`;
  const mins = Math.max(1, Math.floor(secs / 60));
  return `${mins}m`;
}

/**
 * Map a CLN `network` string from getinfo to the coordinator-side network key.
 * Returns null for networks the coordinator protocol doesn't cover (regtest etc).
 */
function clnNetworkToCoordKey(net: string | undefined): CoordinatorNetwork | null {
  if (!net) return null;
  const lower = net.toLowerCase();
  if (lower === 'bitcoin' || lower === 'mainnet') return 'bitcoin';
  if (lower === 'signet') return 'signet';
  if (lower === 'testnet4') return 'testnet4';
  return null;
}

const VouchList = () => {
  useInjectReducer('rendezvous', rendezvousReducer);
  const dispatch = useDispatch();

  const settings = useSelector(selectRendezvousSettings);
  const vouches = useSelector(selectMergedVouchList);
  const isLoading = useSelector(selectVouchesLoading);
  const errors = useSelector(selectVouchErrors);
  const counts = useSelector(selectVouchCounts);
  const activeProfile = useSelector(selectActiveProfile);
  const enabledRelays = useSelector(selectEnabledRelays);

  const network = clnNetworkToCoordKey(activeProfile?.network);
  const selectActiveCoords = useMemo(
    () => makeSelectActiveCoordinators(network ?? 'signet'),
    [network],
  );
  const activeCoordinators = useSelector(selectActiveCoords);

  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const lastFetchKeyRef = useRef<string>('');

  // Lazy-load settings if a sibling component hasn't already.
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

  const refresh = useCallback(async () => {
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

  // Auto-fetch on mount and whenever the inputs that drive a fetch change.
  useEffect(() => {
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
    refresh();
  }, [settings, network, activeCoordinators, enabledRelays, refresh]);

  // Periodic auto-refresh.
  useEffect(() => {
    if (!settings) return;
    const intervalMs = Math.max(1, settings.vouchRefreshMin) * 60_000;
    const id = setInterval(() => { refresh(); }, intervalMs);
    return () => clearInterval(id);
  }, [settings, refresh]);

  const filtered: Vouch[] = useMemo(
    () => (tierFilter === 'all' ? vouches : vouches.filter(v => v.tier === tierFilter)),
    [vouches, tierFilter],
  );

  const errorEntries = Object.entries(errors).filter(([, msg]) => msg);

  const showPeerCount = settings?.showPeerTier?.[network ?? 'signet'];
  const tierFilters: TierFilter[] = showPeerCount
    ? ['all', 'channel', 'utxo', 'peer']
    : ['all', 'channel', 'utxo'];

  return (
    <div className='vouch-list' data-testid='vouch-list'>
      <div className='d-flex justify-content-between align-items-center mb-2 gap-2 flex-wrap'>
        <div className='d-flex align-items-center gap-2 flex-wrap'>
          {tierFilters.map(t => (
            <button
              key={t}
              className={`connect-filter-chip btn-rounded btn-sm ${tierFilter === t ? 'connect-chip-active' : 'connect-chip-inactive'}`}
              onClick={() => setTierFilter(t)}
            >
              {t === 'all'
                ? `All (${vouches.length})`
                : `${TIER_LABEL[t as VouchTier]} (${counts[t as VouchTier] ?? 0})`}
            </button>
          ))}
        </div>
        <div className='d-flex align-items-center gap-2'>
          {isLoading && <Spinner size='sm' animation='border' />}
          <Button size='sm' variant='outline-primary' onClick={refresh} disabled={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      {!network && (
        <Row className='text-light fs-6 my-3 px-2 text-center'>
          Active node's network ({activeProfile?.network ?? 'unknown'}) is not covered by any
          configured coordinator. Switch to a signet, testnet4, or mainnet node to see vouches.
        </Row>
      )}

      {network && activeCoordinators.length === 0 && (
        <Row className='text-light fs-6 my-3 px-2 text-center'>
          No coordinators enabled for {network}. Open Rendezvous settings below to enable one.
        </Row>
      )}

      {network && activeCoordinators.length > 0 && filtered.length === 0 && !isLoading && (
        <Row className='text-light fs-6 my-3 px-2 text-center'>
          {vouches.length === 0
            ? 'No vouches returned. Coordinator may have an empty list yet, or relays may be unreachable.'
            : `No ${tierFilter !== 'all' ? tierFilter + '-tier' : ''} vouches matched.`}
        </Row>
      )}

      {filtered.length > 0 && (
        <>
          <Row className='connect-col-headers text-light px-0 pt-2 pb-1 mx-0'>
            <Col xs={2}>Tier</Col>
            <Col xs={5}>LN Node</Col>
            <Col xs={2}>Expires</Col>
            <Col xs={3} className='text-end'>Action</Col>
          </Row>
          <PerfectScrollbar>
            <ListGroup variant='flush' className='fs-7 pe-1'>
              {filtered.map(v => {
                const isSelected = selectedKey === v.ln_node_id;
                return (
                  <ListGroup.Item
                    key={v.ln_node_id + v.coordinator}
                    className={`connect-list-item px-0 py-2 ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedKey(prev => prev === v.ln_node_id ? null : v.ln_node_id)}
                  >
                    <Row className='align-items-center mx-0'>
                      <Col xs={2}>
                        <OverlayTrigger placement='auto' overlay={<Tooltip>{TIER_TOOLTIP[v.tier]}</Tooltip>}>
                          <Badge bg={TIER_BADGE_BG[v.tier]} className='connect-badge-md text-uppercase'>
                            {v.tier}
                          </Badge>
                        </OverlayTrigger>
                      </Col>
                      <Col xs={5} className='font-monospace text-truncate'>
                        {shortPubkey(v.ln_node_id)}
                      </Col>
                      <Col xs={2}>{formatExpiresIn(v.expires_at)}</Col>
                      <Col xs={3} className='text-end'>
                        <OverlayTrigger
                          placement='auto'
                          overlay={<Tooltip>Coming soon — needs plugin RPC `factory-browse`.</Tooltip>}
                        >
                          <span>
                            <Button size='sm' variant='outline-primary' disabled>
                              Browse Factories
                            </Button>
                          </span>
                        </OverlayTrigger>
                      </Col>
                    </Row>

                    {isSelected && (
                      <Row className='mt-2 mx-0 vouch-detail'>
                        <Col xs={12}>
                          <div className='fs-7'>
                            <span className='fw-semibold'>Pubkey:</span>{' '}
                            <span
                              className='font-monospace cursor-pointer text-decoration-underline'
                              onClick={(e) => { e.stopPropagation(); copyTextToClipboard(v.ln_node_id); }}
                            >
                              {v.ln_node_id}
                            </span>
                          </div>
                          {v.ln_addresses && v.ln_addresses.length > 0 && (
                            <div className='fs-7 mt-1'>
                              <span className='fw-semibold'>Addresses:</span>{' '}
                              <span className='font-monospace'>{v.ln_addresses.join(', ')}</span>
                            </div>
                          )}
                          <div className='fs-7 mt-1 text-light'>
                            Verified {new Date(v.verified_at * 1000).toLocaleString()}
                            {' · '}
                            from coordinator {v.coordinator.slice(0, 16)}…
                          </div>
                        </Col>
                      </Row>
                    )}
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          </PerfectScrollbar>
        </>
      )}

      {errorEntries.length > 0 && (
        <div className='vouch-errors mt-2 fs-7 text-danger'>
          {errorEntries.map(([npub, msg]) => (
            <div key={npub}>
              <span className='font-monospace'>{npub === '_global' ? 'global' : npub.slice(0, 14)}…</span>{' '}
              — {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VouchList;
