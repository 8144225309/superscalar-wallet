import './FactoryList.scss';
import { useState, useMemo, useEffect } from 'react';
import PerfectScrollbar from 'react-perfect-scrollbar';
import { Spinner, Card, Row, Col, ListGroup, Alert, OverlayTrigger, Tooltip, ButtonGroup, Button } from 'react-bootstrap';
import { ActionSVG } from '../../../svgs/Action';
import { useSelector } from 'react-redux';
import { selectIsAuthenticated, selectNodeInfo } from '../../../store/rootSelectors';
import { selectFactories, selectFactoriesLoading, selectFactoriesError, selectRoleCounts } from '../../../store/factoriesSelectors';
import { FactoriesService } from '../../../services/http.service';
import logger from '../../../services/logger.service';
import { Factory, FactoryLifecycle, FactoryCeremony } from '../../../types/factories.type';

// Task #150: a factory qualifies for plugin-side Discard (factory-forget RPC)
// only when it has zero on-chain footprint. Mirrors the plugin's safety gate
// so the button stays disabled rather than producing a server-side reject.
const canDiscard = (f: Factory): boolean => {
  if (f.lifecycle !== FactoryLifecycle.ABORTED && f.lifecycle !== FactoryLifecycle.FAILED) {
    // Allow a UI Discard for non-FAILED items whose ceremony is failed, since the
    // plugin's #149 work auto-transitions those to FAILED on the LSP side; the
    // client-side mirror lags a bit. Keep it conservative: only when ceremony=failed.
    if (f.ceremony !== FactoryCeremony.FAILED) return false;
  }
  if (f.n_channels && f.n_channels > 0) return false;
  if (f.funding_txid && /[1-9a-f]/i.test(f.funding_txid)) return false; // any non-zero hex = funded
  return true;
};

type RoleFilter = 'all' | 'lsp' | 'client';
type Bucket = 'live' | 'history' | 'incomplete';

const lifecycleBadge = (lifecycle: FactoryLifecycle) => {
  switch (lifecycle) {
    case FactoryLifecycle.ACTIVE: return 'bg-success';
    case FactoryLifecycle.SIGNED: return 'bg-primary';
    case FactoryLifecycle.INIT:
    case FactoryLifecycle.AWAITING_JOINS:
    case FactoryLifecycle.READY_TO_TRIGGER:
    case FactoryLifecycle.CEREMONY_RUNNING:
    case FactoryLifecycle.DYING:
      return 'bg-warning';
    case FactoryLifecycle.EXPIRED:
      return 'bg-danger';
    default:
      return 'bg-secondary';
  }
};

const lifecycleOrder: Record<string, number> = {
  [FactoryLifecycle.ACTIVE]: 0,
  [FactoryLifecycle.DYING]: 1,
  [FactoryLifecycle.SIGNED]: 2,
  [FactoryLifecycle.CEREMONY_RUNNING]: 3,
  [FactoryLifecycle.READY_TO_TRIGGER]: 4,
  [FactoryLifecycle.AWAITING_JOINS]: 5,
  [FactoryLifecycle.INIT]: 6,
};

// Succeeded-then-ended states: real funds/channels once existed here. Retained
// as History (breach-watch + accounting), never auto-discarded.
const HISTORY_LIFECYCLES = new Set<string>([
  FactoryLifecycle.EXPIRED,
  FactoryLifecycle.CLOSED_EXTERNALLY,
  FactoryLifecycle.CLOSED_COOPERATIVE,
  FactoryLifecycle.CLOSED_UNILATERAL,
  FactoryLifecycle.CLOSED_BREACHED,
]);

// Classify a factory for display. A failed ceremony currently leaves the plugin
// lifecycle at INIT, so the "did not complete" bucket is also keyed off
// ceremony === FAILED until the plugin auto-terminalizes failed drafts (follow-up).
const bucketOf = (f: Factory): Bucket => {
  if (f.lifecycle === FactoryLifecycle.ABORTED
      || f.lifecycle === FactoryLifecycle.FAILED
      || f.ceremony === FactoryCeremony.FAILED) return 'incomplete';
  if (HISTORY_LIFECYCLES.has(f.lifecycle)) return 'history';
  return 'live';
};

const statusBadgeClass = (f: Factory): string => {
  if (f.lifecycle === FactoryLifecycle.ACTIVE) return 'bg-success';
  if (f.lifecycle === FactoryLifecycle.ABORTED) return 'bg-secondary';
  if (f.ceremony === FactoryCeremony.FAILED) return 'bg-danger';
  if (f.ceremony === FactoryCeremony.COMPLETE) return 'bg-primary';
  return 'bg-secondary';
};

const statusBadgeLabel = (f: Factory): string => {
  if (f.lifecycle === FactoryLifecycle.ACTIVE) return 'Active';
  if (f.lifecycle === FactoryLifecycle.ABORTED) return 'Aborted';
  if (f.ceremony === FactoryCeremony.FAILED) return 'Failed';
  if (f.ceremony === FactoryCeremony.COMPLETE) return 'Signed';
  return f.ceremony;
};

const sortFactories = (list: Factory[]): Factory[] =>
  [...list].sort((a, b) => {
    const la = lifecycleOrder[a.lifecycle] ?? 99;
    const lb = lifecycleOrder[b.lifecycle] ?? 99;
    if (la !== lb) return la - lb;
    return (b.creation_block || 0) - (a.creation_block || 0);
  });

const hiddenStorageKey = (nodeId?: string): string => `ss-hidden-factories:${nodeId || 'unknown'}`;

type FactoryListProps = {
  onCreateFactory: () => void;
  onFactoryClick: (factory: Factory) => void;
};

const FactoryListItem = ({ factory, onClick, hidden, onToggleHide, onDiscard, discarding }: {
  factory: Factory;
  onClick: () => void;
  hidden: boolean;
  onToggleHide: (instanceId: string) => void;
  onDiscard: (instanceId: string) => void;
  discarding: boolean;
}) => (
  <li
    className='list-group-item list-item-channel cursor-pointer'
    onClick={onClick}
    data-testid='list-item-factory'
  >
    <div className='list-item-div flex-fill text-dark'>
      <div className='d-flex align-items-center justify-content-between'>
        <div className='fw-bold d-flex align-items-center gap-2 flex-wrap'>
          <OverlayTrigger
            placement='auto'
            delay={{ show: 250, hide: 250 }}
            overlay={<Tooltip>{factory.lifecycle} - {factory.ceremony}</Tooltip>}
          >
            <span>
              <div className={'d-inline-block mx-1 dot ' + lifecycleBadge(factory.lifecycle)}></div>
              {factory.instance_id.substring(0, 16)}...
            </span>
          </OverlayTrigger>
          <span
            className={'badge ' + (factory.is_lsp ? 'bg-primary' : 'bg-info text-dark')}
            data-testid='factory-role-badge'
          >
            {factory.is_lsp ? 'LSP' : 'Client'}
          </span>
        </div>
        <div className='d-flex align-items-center gap-2'>
          <span className={'badge ' + statusBadgeClass(factory)}>
            {statusBadgeLabel(factory)}
          </span>
          <Button
            variant='link'
            size='sm'
            className='p-0 text-light text-decoration-none fs-8'
            title={hidden ? 'Unhide this factory' : 'Hide this factory from the list'}
            data-testid='factory-hide-toggle'
            onClick={(e) => { e.stopPropagation(); onToggleHide(factory.instance_id); }}
          >
            {hidden ? 'Unhide' : 'Hide'}
          </Button>
          {canDiscard(factory) && (
            <Button
              variant='link'
              size='sm'
              className='p-0 text-danger text-decoration-none fs-8'
              title='Hard-delete this factory record (only allowed for failed drafts with no on-chain footprint)'
              data-testid='factory-discard-btn'
              disabled={discarding}
              onClick={(e) => { e.stopPropagation(); onDiscard(factory.instance_id); }}
            >
              {discarding ? '…' : 'Discard'}
            </Button>
          )}
        </div>
      </div>
      <Row className='text-light fs-7 mt-1'>
        <Col xs={3}>
          <span className='fw-bold text-dark'>{factory.n_channels}</span> ch
        </Col>
        <Col xs={3}>
          <span className='fw-bold text-dark'>{factory.n_clients}</span> clients
        </Col>
        <Col xs={3}>
          Ep <span className='fw-bold text-dark'>{factory.epoch}/{factory.max_epochs || '?'}</span>
        </Col>
        <Col xs={3}>
          <span className='fw-bold text-dark'>{factory.tree_nodes}</span> nodes
        </Col>
      </Row>
    </div>
  </li>
);

const FactoryList = (props: FactoryListProps) => {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const factories = useSelector(selectFactories);
  const isLoading = useSelector(selectFactoriesLoading);
  const error = useSelector(selectFactoriesError);
  const roleCounts = useSelector(selectRoleCounts);
  const nodeInfo = useSelector(selectNodeInfo);
  const nodeId = nodeInfo?.id;

  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // Track in-flight factory-forget RPCs so the Discard button shows a busy
  // state and we don't double-fire on rapid clicks.
  const [discardingIds, setDiscardingIds] = useState<Set<string>>(new Set());

  // TEMP: always show the pill until nostr rendezvous lands so single-role
  // nodes can still preview the Client view.
  const showPill = true;

  // Hide set is per-node (keyed by pubkey) and local to the browser.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey(nodeId));
      setHidden(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setHidden(new Set());
    }
  }, [nodeId]);

  const toggleHide = (instanceId: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      try {
        localStorage.setItem(hiddenStorageKey(nodeId), JSON.stringify([...next]));
      } catch {
        /* localStorage unavailable; hide is best-effort */
      }
      return next;
    });
  };

  // Task #150: hard-delete a factory record via the plugin's factory-forget
  // RPC. Safety-gated server-side; canDiscard() mirrors the gate so the
  // button stays disabled rather than producing a server-side reject.
  const handleDiscard = async (instanceId: string) => {
    setDiscardingIds(prev => {
      const next = new Set(prev);
      next.add(instanceId);
      return next;
    });
    try {
      await FactoriesService.forgetFactory(instanceId);
      await FactoriesService.fetchFactoriesData();
    } catch (err) {
      logger.error('factory-forget failed:', err);
    } finally {
      setDiscardingIds(prev => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
    }
  };

  const groups = useMemo(() => {
    const base = !factories
      ? []
      : roleFilter === 'all'
        ? factories
        : factories.filter(f => (roleFilter === 'lsp' ? f.is_lsp : !f.is_lsp));
    const live: Factory[] = [];
    const history: Factory[] = [];
    const incomplete: Factory[] = [];
    const hiddenItems: Factory[] = [];
    for (const f of base) {
      if (hidden.has(f.instance_id)) { hiddenItems.push(f); continue; }
      const b = bucketOf(f);
      if (b === 'live') live.push(f);
      else if (b === 'history') history.push(f);
      else incomplete.push(f);
    }
    return {
      live: sortFactories(live),
      history: sortFactories(history),
      incomplete: sortFactories(incomplete),
      hiddenItems: sortFactories(hiddenItems),
    };
  }, [factories, roleFilter, hidden]);

  const renderItems = (items: Factory[]) =>
    items.map((factory, idx) => (
      <FactoryListItem
        key={factory.instance_id || idx}
        factory={factory}
        hidden={hidden.has(factory.instance_id)}
        onToggleHide={toggleHide}
        onDiscard={handleDiscard}
        discarding={discardingIds.has(factory.instance_id)}
        onClick={() => props.onFactoryClick(factory)}
      />
    ));

  const renderSection = (
    label: string,
    items: Factory[],
    open: boolean,
    onToggle: () => void,
    testid: string,
  ) => (
    items.length > 0 ? (
      <div>
        <div
          className='d-flex justify-content-between align-items-center px-2 py-1 mt-2 cursor-pointer fw-bold fs-8 text-light'
          onClick={onToggle}
          data-testid={testid}
        >
          <span>{label} <span className='badge bg-secondary ms-1'>{items.length}</span></span>
          <span>{open ? '▾' : '▸'}</span>
        </div>
        {open && (
          <ListGroup as='ul' variant='flush' className='list-channels'>
            {renderItems(items)}
          </ListGroup>
        )}
      </div>
    ) : null
  );

  const anything =
    groups.live.length + groups.history.length + groups.incomplete.length + groups.hiddenItems.length > 0;

  return (
    <Card className='h-100 d-flex align-items-stretch px-4 pt-4 pb-3' data-testid='factory-list'>
      <Card.Header className='px-1 pb-2 fs-18px p-0 fw-bold text-dark d-flex justify-content-between align-items-center flex-wrap gap-2'>
        <span>Channel Factories</span>
        {showPill && (
          <ButtonGroup size='sm' aria-label='Role filter' data-testid='role-filter'>
            <Button
              variant={roleFilter === 'all' ? 'primary' : 'outline-secondary'}
              onClick={() => setRoleFilter('all')}
              data-testid='role-filter-all'
            >
              All <span className='badge bg-light text-dark ms-1'>{roleCounts.lsp + roleCounts.client}</span>
            </Button>
            <Button
              variant={roleFilter === 'lsp' ? 'primary' : 'outline-secondary'}
              onClick={() => setRoleFilter('lsp')}
              data-testid='role-filter-lsp'
            >
              LSP <span className='badge bg-light text-dark ms-1'>{roleCounts.lsp}</span>
            </Button>
            <Button
              variant={roleFilter === 'client' ? 'primary' : 'outline-secondary'}
              onClick={() => setRoleFilter('client')}
              data-testid='role-filter-client'
            >
              Client <span className='badge bg-light text-dark ms-1'>{roleCounts.client}</span>
            </Button>
          </ButtonGroup>
        )}
      </Card.Header>
      <Card.Body className='py-0 px-1 channels-scroll-container' style={{ overflowY: 'auto' }}>
        {isAuthenticated && isLoading ? (
          <span className='h-100 d-flex justify-content-center align-items-center'>
            <Spinner animation='grow' variant='primary' />
          </span>
        ) : error ? (
          <Alert className='fs-8' variant='danger'>{error}</Alert>
        ) : anything ? (
          <PerfectScrollbar>
            {groups.live.length > 0 ? (
              <ListGroup as='ul' variant='flush' className='list-channels'>
                {renderItems(groups.live)}
              </ListGroup>
            ) : (
              <div className='text-light fs-8 text-center py-3' data-testid='no-live-factories'>
                No active factories for this view.
              </div>
            )}
            {renderSection('Failed / abandoned', groups.incomplete, showIncomplete, () => setShowIncomplete(v => !v), 'section-incomplete')}
            {renderSection('History', groups.history, showHistory, () => setShowHistory(v => !v), 'section-history')}
            {renderSection('Hidden', groups.hiddenItems, showHidden, () => setShowHidden(v => !v), 'section-hidden')}
          </PerfectScrollbar>
        ) : (
          <Row className='text-light fs-6 mt-3 h-100 mt-2 align-items-center justify-content-center'>
            <Row className='d-flex align-items-center justify-content-center'>
              <Row className='text-center pb-4'>
                {roleFilter === 'all'
                  ? 'No factories found. Create a factory to start!'
                  : `No ${roleFilter === 'lsp' ? 'LSP' : 'Client'} factories for this node.`}
              </Row>
            </Row>
          </Row>
        )}
      </Card.Body>
      <Card.Footer className='d-flex justify-content-center'>
        <button tabIndex={1} className='btn-rounded bg-primary' onClick={props.onCreateFactory} data-testid='button-create-factory'>
          Host Factory
          <ActionSVG className='ms-3' />
        </button>
      </Card.Footer>
    </Card>
  );
};

export default FactoryList;
