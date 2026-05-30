import { render, screen, cleanup } from '@testing-library/react';
import InfoIcon from './InfoIcon';

afterEach(() => {
  cleanup();
});

describe('InfoIcon', () => {
  it('renders the ⓘ Unicode glyph (U+24D8)', () => {
    render(<InfoIcon text='MuSig2 is a multi-signature scheme.' />);
    /* The glyph itself: ⓘ */
    expect(screen.getByText('ⓘ')).toBeInTheDocument();
  });

  it('honours an explicit testid prop', () => {
    render(<InfoIcon text='Hover text' testid='musig2-info' />);
    expect(screen.getByTestId('musig2-info')).toBeInTheDocument();
  });

  it('omits data-testid attribute when none is provided', () => {
    render(<InfoIcon text='No testid here' />);
    /* The span around the glyph should not carry a data-testid attr. */
    const span = screen.getByText('ⓘ');
    expect(span).not.toHaveAttribute('data-testid');
  });

  it('uses the cursor-pointer + text-info classes for visual hover affordance', () => {
    render(<InfoIcon text='Affordance test' testid='aff' />);
    const span = screen.getByTestId('aff');
    expect(span.className).toContain('cursor-pointer');
    expect(span.className).toContain('text-info');
  });

  it('accepts a long multi-sentence tooltip without crashing', () => {
    const longText = 'Factory rotation re-signs the DW tree. '.repeat(10);
    render(<InfoIcon text={longText} testid='long-tip' />);
    expect(screen.getByTestId('long-tip')).toBeInTheDocument();
  });
});
