import './Logout.scss';
import { Modal, Col } from 'react-bootstrap';

import { QuestionMarkSVG } from '../../../svgs/QuestionMark';
import { RootService } from '../../../services/http.service';
import { clearBKPRStore } from '../../../store/bkprSlice';
import { clearRootStore, setShowModals } from '../../../store/rootSlice';
import { clearCLNStore } from '../../../store/clnSlice';
import { useDispatch, useSelector } from 'react-redux';
import { selectShowModals } from '../../../store/rootSelectors';

/**
 * Logout — confirm-logout modal.
 *
 * What it renders
 *   A small confirmation modal triggered from the Header's logout
 *   button. Two-button: Confirm / Cancel.
 *
 * Side effects
 *   - Confirm: RootService.userLogout() → clearRootStore +
 *     clearCLNStore + clearBKPRStore → dispatch setShowModals to
 *     close the modal. The JWT cookie is cleared server-side; the
 *     Login modal will mount on the next render because
 *     isAuthenticated flips false.
 *
 * Why explicit confirm
 *   The wallet UI persists per-session form drafts and timeline
 *   filters. An accidental logout discards them. The modal makes
 *   logout intentional.
 *
 * Props contract
 *   None — visibility driven by selectShowModals.logoutModal.
 */
const LogoutComponent = () => {
  const dispatch = useDispatch();
  const showModals = useSelector(selectShowModals); 

  const logoutHandler = event => {
    if (event === true) {
      RootService.userLogout();
      dispatch(clearRootStore())
      dispatch(clearCLNStore())
      dispatch(clearBKPRStore())
      closeHandler(true);
    } else {
      closeHandler(false);
    }
  };

  const closeHandler = (showLogin?: boolean) => {
    dispatch(setShowModals({ ...showModals, loginModal: showLogin || false, logoutModal: false }));
  }

  return (
    <form className='h-100'>
      <Modal show={showModals.logoutModal} onHide={closeHandler} centered className='modal-lg border-0' data-testid='logout-modal'>
        <Modal.Body className='p-0 w-100 d-flex align-items-start justify-content-start'>
          <Col className='d-flex align-items-stretch justify-content-between modal-box'>
            <Col xs={2} className='message-type-box d-flex align-items-center justify-content-center'>
              <QuestionMarkSVG />
            </Col>
            <Col xs={10} className="p-3">
              <Col className="d-flex align-items-center justify-content-between">
                <Col xs={7} className="ps-1">
                  Logout?
                </Col>
                <button
                  type="button"
                  className="btn btn-rounded btn-sm btn-secondary"
                  onClick={() => logoutHandler(true)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="btn btn-rounded btn-sm btn-secondary"
                  onClick={() => logoutHandler(false)}
                >
                  No
                </button>
              </Col>
            </Col>
          </Col>
        </Modal.Body>
      </Modal>
    </form>
  );
};

export default LogoutComponent;
