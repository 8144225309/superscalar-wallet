import { KeyboardEvent } from 'react';
import { CloseSVG } from '../../../svgs/Close';

/* Reusable accessible close button for modals.
 *
 * Replaces the `<span className='span-close-svg' onClick={...}>` pattern
 * scattered across modal headers. The span had no role / tabindex /
 * keyboard handler, so screen-reader and keyboard-only users couldn't
 * dismiss the modal.
 *
 * Uses role='button' + tabIndex=0 + Enter/Space handlers + aria-label
 * so it announces correctly and is reachable via Tab. */

type Props = {
  onClose: () => void;
  label?: string;
  testId?: string;
};

const CloseButton = ({ onClose, label = 'Close', testId }: Props) => {
  const handleKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <span
      className='span-close-svg'
      onClick={onClose}
      onKeyDown={handleKey}
      role='button'
      tabIndex={0}
      aria-label={label}
      data-testid={testId}
    >
      <CloseSVG />
    </span>
  );
};

export default CloseButton;
