import { Spinner } from 'react-bootstrap';

/* Shared inline-loading widget. Single source of truth for the
 * "border spinner + sm size + label" pattern that previously varied
 * by margin (me-1 vs me-2), ellipsis style (... vs …), and label
 * phrasing across NodePicker / SigningPrefs / submit buttons / etc.
 *
 * Use this anywhere an inline loading indicator follows a label
 * (button text, status line, dropdown toggle, etc.). For full-page
 * "loading the world" states keep using Loading/Loading.tsx
 * (Spinner animation='grow'). */

type InlineSpinnerProps = {
  /** Optional label rendered after the spinner. Trailing "…" added automatically. */
  label?: string;
  /** Margin between spinner and label. Default 0.5 (me-2). */
  marginEnd?: 1 | 2;
  /** Override the data-testid for sweep-friendliness. */
  testid?: string;
};

const InlineSpinner = ({ label, marginEnd = 2, testid }: InlineSpinnerProps) => (
  <>
    <Spinner
      animation='border'
      size='sm'
      className={'me-' + marginEnd}
      data-testid={testid ?? 'inline-spinner'}
    />
    {label ? `${label.replace(/[.…]+$/, '')}…` : null}
  </>
);

export default InlineSpinner;
