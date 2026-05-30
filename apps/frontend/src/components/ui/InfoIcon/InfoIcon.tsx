import { OverlayTrigger, Tooltip } from 'react-bootstrap';

/**
 * Info Icon — ⓘ tooltip badge for protocol-term explanations.
 *
 * What it renders
 *   A small Unicode ⓘ (U+24D8) wrapped in an OverlayTrigger so hover
 *   reveals an inline tooltip with the explanation. Used everywhere
 *   a protocol term appears in a label: MuSig2, kickoff TX, epoch,
 *   DW timelock, L-stock, factory-join-request, etc.
 *
 * Why a shared component
 *   The R1.2 tooltip pass identified ~20 surfaces where InfoIcon was
 *   needed; consolidating into one widget keeps the placement +
 *   delay + styling consistent across the wallet.
 *
 * Props contract
 *   - `text: string`   — the tooltip body
 *   - `testid?: string` — optional data-testid override (for tests)
 */

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
