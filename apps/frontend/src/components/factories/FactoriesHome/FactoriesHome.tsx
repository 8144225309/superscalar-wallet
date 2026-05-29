import './FactoriesHome.scss';
import { Row, Col } from 'react-bootstrap';
import { useLocation, Link } from 'react-router-dom';
import Header from '../../ui/Header/Header';
import { useSelector } from 'react-redux';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import factoryEventsReducer from '../../../store/factoryEventsSlice';
import { useFactoryEventStream } from '../../../utilities/useFactoryEventStream';
import factoriesReducer from '../../../store/factoriesSlice';
import { selectNodeInfo } from '../../../store/rootSelectors';
import FactoriesOverview from '../FactoriesOverview/FactoriesOverview';
import FactoryListCard from '../FactoryListCard/FactoryListCard';
import ExpiryWarnings from '../ExpiryWarnings/ExpiryWarnings';
import BreachStatus from '../BreachStatus/BreachStatus';
import LadderingTimeline from '../LadderingTimeline/LadderingTimeline';
import SigningPrefs from '../SigningPrefs/SigningPrefs';
import OperatorPrefs from '../OperatorPrefs/OperatorPrefs';
import KnownPeers from '../KnownPeers/KnownPeers';
import PendingProposalsCard from '../ReviewProposal/PendingProposalsCard';
import JoinQueueBanner from '../JoinQueueBanner/JoinQueueBanner';
import HeldProposalsBanner from '../ReviewProposal/HeldProposalsBanner';
import MissedCeremoniesBanner from '../ReviewProposal/MissedCeremoniesBanner';
import LspOperatorConsole from '../LspOperatorConsole/LspOperatorConsole';

function FactoriesHome() {
  useInjectReducer('factories', factoriesReducer);
  useInjectReducer("factoryEvents", factoryEventsReducer);
  useFactoryEventStream();
  const nodeInfo = useSelector(selectNodeInfo);
  const { pathname } = useLocation();
  const isCreate = pathname.endsWith('/factories/create');
  const isSigningPrefs = pathname.endsWith('/factories/signing-prefs');
  const isOperatorPrefs = pathname.endsWith('/factories/operator-prefs');
  const isKnownPeers = pathname.endsWith('/factories/peers');
  const isOperatorConsole = pathname.endsWith('/factories/console');

  return (
    <div data-testid='factories-container'>
      <Header />
      {nodeInfo.error ? (
        <Row className='message invalid mt-4'>
          <Col xs={12} className='d-flex align-items-center justify-content-center'>
            {nodeInfo.error}
          </Col>
        </Row>
      ) : isCreate ? (
        <Row className='px-3'>
          <Col xs={12} className='cards-container'>
            <FactoryListCard />
          </Col>
        </Row>
      ) : isSigningPrefs ? (
        <Row className='px-3'>
          <Col xs={12}>
            <SigningPrefs />
          </Col>
        </Row>
      ) : isOperatorPrefs ? (
        <Row className='px-3'>
          <Col xs={12}>
            <OperatorPrefs />
          </Col>
        </Row>
      ) : isKnownPeers ? (
        <Row className='px-3'>
          <Col xs={12}>
            <KnownPeers />
          </Col>
        </Row>
      ) : isOperatorConsole ? (
        <Row className='px-3'>
          <Col xs={12}>
            <LspOperatorConsole />
          </Col>
        </Row>
      ) : (
        <>
          {/* Top: stats overview */}
          <Row>
            <Col className='mx-1'>
              <FactoriesOverview />
            </Col>
          </Row>

          {/* Main content: factories list + side cards (expiry, breach) */}
          <Row className='px-3'>
            <Col xs={12} lg={8} className='cards-container'>
              <FactoryListCard />
            </Col>
            <Col xs={12} lg={4} className='cards-container d-flex flex-column'>
              <ExpiryWarnings />
              <BreachStatus />
            </Col>
          </Row>

          {/* Factory timeline */}
          <Row className='px-3'>
            <Col xs={12} className='cards-container'>
              <LadderingTimeline />
            </Col>
          </Row>

          {/* Footer: signing / proposal activity. Each child renders null
              when empty so this section collapses out of the way when
              there\u2019s nothing to act on. */}
          <Row className='px-3 mt-3'>
            <Col xs={12}>
              <JoinQueueBanner />
              <HeldProposalsBanner />
              <MissedCeremoniesBanner />
              <PendingProposalsCard />
            </Col>
          </Row>
          <Row className='px-3'>
            <Col xs={12} className='d-flex justify-content-end mb-3'>
              <Link to='/factories/console' className='text-decoration-none me-3' data-testid='operator-console-link'>
                <small>LSP operator console &rsaquo;</small>
              </Link>
              <Link to='/factories/operator-prefs' className='text-decoration-none me-3' data-testid='operator-prefs-link'>
                <small>LSP operator preferences &rsaquo;</small>
              </Link>
              <Link to='/factories/peers' className='text-decoration-none me-3' data-testid='known-peers-link'>
                <small>Known peers &rsaquo;</small>
              </Link>
              <Link to='/factories/signing-prefs' className='text-decoration-none' data-testid='signing-prefs-link'>
                <small>Signing preferences &rsaquo;</small>
              </Link>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}

export default FactoriesHome;
