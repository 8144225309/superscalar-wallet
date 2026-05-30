import { render, screen, fireEvent } from '@testing-library/react';
import CloseButton from './CloseButton';

describe('CloseButton', () => {
  it('renders with default aria-label "Close"', () => {
    render(<CloseButton onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('uses the provided label as aria-label', () => {
    render(<CloseButton onClose={() => undefined} label='Close node info' />);
    expect(screen.getByRole('button', { name: 'Close node info' })).toBeInTheDocument();
  });

  it('exposes itself to screen readers as a button (role=button + tabIndex=0)', () => {
    render(<CloseButton onClose={() => undefined} label='X' />);
    const btn = screen.getByRole('button', { name: 'X' });
    expect(btn).toHaveAttribute('tabindex', '0');
  });

  it('fires onClose on click', () => {
    let fired = 0;
    render(<CloseButton onClose={() => { fired++; }} label='X' />);
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    expect(fired).toBe(1);
  });

  it('fires onClose on Enter key', () => {
    let fired = 0;
    render(<CloseButton onClose={() => { fired++; }} label='X' />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'X' }), { key: 'Enter' });
    expect(fired).toBe(1);
  });

  it('fires onClose on Space key', () => {
    let fired = 0;
    render(<CloseButton onClose={() => { fired++; }} label='X' />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'X' }), { key: ' ' });
    expect(fired).toBe(1);
  });

  it('does NOT fire onClose on other keys', () => {
    let fired = 0;
    render(<CloseButton onClose={() => { fired++; }} label='X' />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'X' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'X' }), { key: 'a' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'X' }), { key: 'Tab' });
    expect(fired).toBe(0);
  });

  it('forwards testId as data-testid', () => {
    render(<CloseButton onClose={() => undefined} label='X' testId='my-close' />);
    expect(screen.getByTestId('my-close')).toBeInTheDocument();
  });
});
