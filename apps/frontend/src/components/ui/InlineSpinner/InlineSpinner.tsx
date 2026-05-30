import { Spinner } from 'react-bootstrap';

/**
 * Inline Spinner — small "loading X…" widget.
 *
 * What it renders
 *   Bootstrap border-spinner (size sm) + optional label, with a
 *   trailing "…" added/normalized automatically (the label can end
 *   in "..." or "…" or neither — same result).
 *
 * Why a shared component
 *   The R1.4 loading-consistency pass found that NodePicker,
 *   SigningPrefs, AcceptInviteModal, JoinFactoryModal etc. each used
 *   slightly different margin (me-1 vs me-2), ellipsis style, and
 *   label phrasing. This widget is the single source of truth for
 *   "spinner + label" inline displays.
 *
 *   For full-page "loading the world" states use Loading/Loading.tsx
 *   (Spinner animation='grow') instead.
 *
 * Props contract
 *   - `label?: string`  — optional label rendered after the spinner
 *   - `marginEnd?: 1|2` — spacing between spinner and label (me-N)
 *   - `testid?: string` — override the data-testid for sweep tests
 */

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
