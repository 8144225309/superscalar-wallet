import { motion } from 'framer-motion';
import { Spinner, Col } from 'react-bootstrap';

import { CallStatus, OPACITY_VARIANTS } from '../../../utilities/constants';
import { copyTextToClipboard, titleCase } from '../../../utilities/data-formatters';
import { InformationSVG } from '../../../svgs/Information';
import { CopySVG } from '../../../svgs/Copy';
import logger from '../../../services/logger.service';
import { setShowToast } from '../../../store/rootSlice';
import { useDispatch } from 'react-redux';

/**
 * Status Alert — universal in-flight / outcome banner.
 *
 * What it renders
 *   The one banner every mutating-action surface uses to surface
 *   Idle / Pending / Success / Error. Variants:
 *   - PENDING: spinner + neutral title (warning Alert)
 *   - SUCCESS: information glyph + titleCase(message) (success Alert)
 *   - ERROR:   information glyph + titleCase(message) + Copy button
 *              (danger Alert) — operator can grab the error text for
 *              an issue or paste it into a debug session
 *   - NONE:    renders nothing (collapsed)
 *
 *   Wired with framer-motion OPACITY_VARIANTS for the fade-in.
 *
 * Side effects
 *   - Copy button: copyTextToClipboard → dispatch(setShowToast(...))
 *     to surface a transient "Response Copied!" confirmation
 *
 * Props contract
 *   - `responseStatus: CallStatus` — Idle / Pending / Success / Error
 *   - `responseMessage: string` — the message to render (titleCased)
 *
 * Why a single component
 *   Every mutating-action surface used to ship its own banner with
 *   slightly different spacing/copy/icon. Consolidating into one
 *   reusable widget per CallStatus is what made the R4.1 inline-style
 *   audit possible.
 */
const StatusAlert = props => {
  const dispatch = useDispatch();

  const copyHandler = () => {
    copyTextToClipboard(props.responseMessage).then(() => {
      dispatch(setShowToast({show: true, message: ('Response Copied Successfully!'), bg: 'success'}));
    }).catch((err) => {
      logger.error(err);
    });
  }

  return props.responseStatus !== CallStatus.NONE ? (
    <motion.div
      data-testid="status-alert"
      className={
        'w-100 d-flex align-items-start justify-content-center alert alert-' +
        (props.responseStatus === CallStatus.ERROR
          ? 'danger'
          : props.responseStatus === CallStatus.PENDING
            ? 'warning'
            : props.responseStatus === CallStatus.SUCCESS
              ? 'success'
              : '')
      }
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={OPACITY_VARIANTS}
      transition={{ ease: 'easeOut', duration: 1 }}
    >
      <Col xs={1} className="d-flex align-items-start justify-content-start mt-1">
        {props.responseStatus === CallStatus.PENDING ? (
          <Spinner
            variant="primary"
            size="sm"
            data-testid="status-pending-spinner"
          />
        ) : (
          <InformationSVG
            svgClassName="information-svg"
            className={props.responseStatus === CallStatus.ERROR ? 'fill-danger' : 'fill-success'}
          />
        )}
      </Col>
      <Col xs={10} className="mt-2px ms-1 px-1 text-status" data-testid="status-alert-message">
        {titleCase(props.responseMessage)}
      </Col>
      {props.responseStatus !== CallStatus.PENDING ? (
        <Col
          xs={1}
          onClick={copyHandler}
          className="d-flex align-items-start justify-content-end btn-sm-svg btn-svg-copy mt-1"
          id=""
        >
          <CopySVG id="" showTooltip={true} />
        </Col>
      ) : (
        <></>
      )}
    </motion.div>
  ) : (
    <></>
  );
};

export default StatusAlert;
