import { render, screen } from '@testing-library/react';
import InlineSpinner from './InlineSpinner';

describe('InlineSpinner', () => {
  it('renders the spinner with default test-id', () => {
    render(<InlineSpinner />);
    expect(screen.getByTestId('inline-spinner')).toBeInTheDocument();
  });

  it('honours a custom testid', () => {
    render(<InlineSpinner testid='my-spinner' />);
    expect(screen.getByTestId('my-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-spinner')).not.toBeInTheDocument();
  });

  it('renders no label text when label prop is absent', () => {
    const { container } = render(<InlineSpinner />);
    /* Only the spinner element; no trailing text node. */
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders the label with a single trailing ellipsis (…)', () => {
    render(<InlineSpinner label='Loading' />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('strips trailing dots (...) before adding the Unicode ellipsis', () => {
    render(<InlineSpinner label='Loading...' />);
    /* Should not be "Loading...…" — ASCII trailing dots get stripped */
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Loading...…')).not.toBeInTheDocument();
  });

  it('strips existing Unicode ellipsis to avoid doubling', () => {
    render(<InlineSpinner label='Loading…' />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('default margin class is me-2', () => {
    render(<InlineSpinner />);
    expect(screen.getByTestId('inline-spinner')).toHaveClass('me-2');
  });

  it('marginEnd=1 prop produces me-1', () => {
    render(<InlineSpinner marginEnd={1} />);
    expect(screen.getByTestId('inline-spinner')).toHaveClass('me-1');
    expect(screen.getByTestId('inline-spinner')).not.toHaveClass('me-2');
  });
});
