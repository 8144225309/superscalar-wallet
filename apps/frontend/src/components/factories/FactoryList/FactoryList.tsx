import './FactoryList.scss';
import { useState, useMemo } from 'react';
import PerfectScrollbar from 'react-perfect-scrollbar';
import { Spinner, Card, Row, Col, ListGroup, Alert, OverlayTrigger, Tooltip, ButtonGroup, Button } from 'react-bootstrap';
import { ActionSVG } from '../../../svgs/Action';
import { useSelector } from 'react-redux';
import { selectIsAuthenticated } from '../../../store/rootSelectors';
import { selectFactories, selectFactoriesLoading, selectFactoriesError, selectRoleCounts } from '../../../store/factoriesSelectors';
import { Factory, FactoryLifecycle } from '../../../types/factories.type';

type RoleFilter = 'all' | 'lsp' | 'client';

const lifecycleBadge = (lifecycle: FactoryLifecycle) => {
  switch (lifecycle) {
    case FactoryLifecycle.ACTIVE: return 'bg-success';
    case FactoryLifecycle.INIT: return 'bg-warning';
    case FactoryLifecycle.DYING: return 'bg-warning';
    case FactoryLifecycle.EXPIRED: return 'bg-danger';
    default: return 'bg-secondary';
  }
};

const lifecycleOrder: Record<string, number> = {
  [FactoryLifecycle.ACTIVE]: 0,
  [FactoryLifecycle.INIT]: 1,
  [FactoryLifecycle.DYING]: 2,
  [FactoryLifecycle.EXPIRED]: 3,
};

type FactoryListProps = {
  onCreateFactory: () => void;
  onFactoryClick: (factory: Factory) => void;
};

const FactoryListItem = ({ factory, onClick }: { factory: Factory; onClick: () => void }) => (
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
        <span className={'badge ' + (factory.lifecycle === 'active' ? 'bg-success' : factory.ceremony === 'complete' ? 'bg-primary' : 'bg-secondary')}>
          {factory.lifecycle === 'active' ? 'Active' : factory.ceremony === 'complete' ? 'Signed' : factory.ceremony}
        </span>
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
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const showPill = roleCounts.lsp > 0 && roleCounts.client > 0;

  const visible = useMemo(() => {
    if (!factories) return [];
    const filtered = roleFilter === 'all'
      ? factories
      : factories.filter(f => roleFilter === 'lsp' ? f.is_lsp : !f.is_lsp);
    return [...filtered].sort((a, b) => {
      const la = lifecycleOrder[a.lifecycle] ?? 99;
      const lb = lifecycleOrder[b.lifecycle] ?? 99;
      if (la !== lb) return la - lb;
      return (b.creation_block || 0) - (a.creation_block || 0);
    });
  }, [factories, roleFilter]);

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
        {isAuthenticated && isLoading ?
          <span className='h-100 d-flex justify-content-center align-items-center'>
            <Spinner animation='grow' variant='primary' />
          </span>
          :
          error ?
            <Alert className='fs-8' variant='danger'>{error}</Alert> :
            visible.length > 0 ?
              <PerfectScrollbar>
                <ListGroup as='ul' variant='flush' className='list-channels'>
                  {visible.map((factory, idx) => (
                    <FactoryListItem
                      key={factory.instance_id || idx}
                      factory={factory}
                      onClick={() => props.onFactoryClick(factory)}
                    />
                  ))}
                </ListGroup>
              </PerfectScrollbar>
              :
              <Row className='text-light fs-6 mt-3 h-100 mt-2 align-items-center justify-content-center'>
                <Row className='d-flex align-items-center justify-content-center'>
                  <Row className='text-center pb-4'>
                    {roleFilter === 'all'
                      ? 'No factories found. Create a factory to start!'
                      : `No ${roleFilter === 'lsp' ? 'LSP' : 'Client'} factories for this node.`}
                  </Row>
                </Row>
              </Row>
        }
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
