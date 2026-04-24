import './FactoriesHome.scss';
import { Row, Col } from 'react-bootstrap';
import { useLocation } from 'react-router-dom';
import Header from '../../ui/Header/Header';
import { useSelector } from 'react-redux';
import { useInjectReducer } from '../../../hooks/use-injectreducer';
import factoriesReducer from '../../../store/factoriesSlice';
import { selectNodeInfo } from '../../../store/rootSelectors';
import FactoriesOverview from '../FactoriesOverview/FactoriesOverview';
import FactoryListCard from '../FactoryListCard/FactoryListCard';
import ExpiryWarnings from '../ExpiryWarnings/ExpiryWarnings';
import BreachStatus from '../BreachStatus/BreachStatus';
import LadderingTimeline from '../LadderingTimeline/LadderingTimeline';

function FactoriesHome() {
  useInjectReducer('factories', factoriesReducer);
  const nodeInfo = useSelector(selectNodeInfo);
  const { pathname } = useLocation();
  const isCreate = pathname.endsWith('/factories/create');

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
      ) : (
        <>
          <Row>
            <Col className='mx-1'>
              <FactoriesOverview />
            </Col>
          </Row>
          <Row className='px-3'>
            <Col xs={12} lg={8} className='cards-container'>
              <FactoryListCard />
            </Col>
            <Col xs={12} lg={4} className='cards-container d-flex flex-column'>
              <ExpiryWarnings />
              <BreachStatus />
            </Col>
          </Row>
          <Row className='px-3'>
            <Col xs={12} className='cards-container'>
              <LadderingTimeline />
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}

export default FactoriesHome;
