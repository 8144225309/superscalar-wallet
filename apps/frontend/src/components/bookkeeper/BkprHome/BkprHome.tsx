import './BkprHome.scss';
import { useLocation } from 'react-router-dom';
import { Row, Col } from 'react-bootstrap';

/**
 * Bkpr Home — /bookkeeper route shell.
 *
 * What it renders
 *   The bookkeeper dashboard. Three info cards (AccountEvents,
 *   SatsFlow, Volume) that each link to their respective full-page
 *   timeline / chart view. Mounts:
 *   - Page Header
 *   - cln Overview hero (reused from /cln)
 *   - AccountEventsInfo + SatsFlowInfo + VolumeInfo summary cards
 *   - RouteTransition wrapper for the slide-in detail views
 *
 * Lazy injection
 *   useInjectReducer('bkpr', bkprReducer) on first mount.
 *
 * Side effects
 *   None — children own their RPCs.
 *
 * Props contract
 *   None — mounted by the router at /bookkeeper.
 */

import RouteTransition from '../../ui/RouteTransition/RouteTransition';
import SatsFlowInfo from './SatsFlowInfo/SatsFlowInfo';
import VolumeInfo from './VolumeInfo/VolumeInfo';
import Overview from '../../cln/Overview/Overview';
import Header from '../../ui/Header/Header';
import AccountEventsInfo from './AccountEventsInfo/AccountEventsInfo';
import { useSelector } from 'react-redux';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import bkprReducer from '../../../store/bkprSlice';
import { selectNodeInfo } from '../../../store/rootSelectors';

const Bookkeeper = () => {
  useInjectReducer('bkpr', bkprReducer);
  const nodeInfo = useSelector(selectNodeInfo);
  const location = useLocation();
  
  return (
    <div data-testid='bookkeeper-dashboard-container' className='d-flex flex-column justify-content-stretch'>
      <Header />
      {nodeInfo.error ? (
        <Row className='message invalid mt-4'>
          <Col xs={12} className='d-flex align-items-center justify-content-center'>
            {nodeInfo.error}
          </Col>
        </Row>
      ) : (
        <>
          <RouteTransition />
          {location.pathname === '/bookkeeper' && (
            <>
            <Row>
              <Col className='mx-1'>
                <Overview />
              </Col>
            </Row>
            <Row className='px-3'>
              <Col xs={12} lg={6} className='cards-container'>
                <AccountEventsInfo />
              </Col>
              <Col xs={12} lg={6} className='cards-container d-flex flex-column justify-content-between'>
                <SatsFlowInfo />
                <VolumeInfo />
              </Col>
            </Row>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default Bookkeeper;
