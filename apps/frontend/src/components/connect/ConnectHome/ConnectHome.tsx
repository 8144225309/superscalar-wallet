import './ConnectHome.scss';
import { Row, Col } from 'react-bootstrap';
import Header from '../../ui/Header/Header';
import ConnectList from '../ConnectList/ConnectList';
import MyJoinAttemptsCard from '../MyJoinAttemptsCard/MyJoinAttemptsCard';
import RendezvousSettings from '../RendezvousSettings/RendezvousSettings';

/**
 * Connect Home — /connect route container.
 *
 * What it renders
 *   The route shell for /connect:
 *   - Page Header
 *   - ConnectList (Discover + Manual + Invite tabbed surface)
 *   - MyJoinAttemptsCard (recent factory-join-request status)
 *   - RendezvousSettings (Nostr relay + coordinator config)
 *
 * Why these three together
 *   Discovery, attempt tracking, and config form a single user task:
 *   "find an LSP, attempt to join, see what happened." Stacking them
 *   on one page avoids the "where do I look?" question.
 *
 * Side effects
 *   None — children own their own polling + RPCs.
 *
 * Props contract
 *   None — mounted by the router at /connect.
 */
function ConnectHome() {
  return (
    <div className='connect-container' data-testid='connect-container'>
      <Header />
      <Row className='px-3'>
        <Col xs={12} className='cards-container'>
          <ConnectList />
          <MyJoinAttemptsCard />
          <RendezvousSettings />
        </Col>
      </Row>
    </div>
  );
}

export default ConnectHome;
