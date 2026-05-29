import { OverlayTrigger, Tooltip } from 'react-bootstrap';

/* Shared widget: a small ⓘ icon that reveals a tooltip on hover.
 * Used to attach lightweight inline explanations to protocol terms
 * (MuSig2, kickoff TX, epoch, DW timelock, L-stock, etc.) without
 * cluttering the label itself. */

type InfoIconProps = {
  text: string;
  testid?: string;
};

const InfoIcon = ({ text, testid }: InfoIconProps) => (
  <OverlayTrigger placement='auto' overlay={<Tooltip>{text}</Tooltip>}>
    <span className='ms-1 text-info cursor-pointer' data-testid={testid}>&#9432;</span>
  </OverlayTrigger>
);

export default InfoIcon;
