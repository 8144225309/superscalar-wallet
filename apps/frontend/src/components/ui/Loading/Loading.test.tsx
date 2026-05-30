import { render, screen } from '@testing-library/react';
import { Loading } from './Loading';

describe('Loading', () => {
  it('renders the row-loading container', () => {
    render(<Loading />);
    expect(screen.getByTestId('row-loading')).toBeInTheDocument();
  });

  it('shows the "Loading..." text', () => {
    render(<Loading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders a Bootstrap grow-style Spinner (not border-style)', () => {
    const { container } = render(<Loading />);
    /* Bootstrap grow spinner renders as a div with class 'spinner-grow'
     * — distinguishes it from InlineSpinner's 'spinner-border'. */
    const grow = container.querySelector('.spinner-grow');
    const border = container.querySelector('.spinner-border');
    expect(grow).toBeInTheDocument();
    expect(border).not.toBeInTheDocument();
  });

  it('uses the primary variant', () => {
    const { container } = render(<Loading />);
    const grow = container.querySelector('.spinner-grow');
    expect(grow?.className).toContain('text-primary');
  });
});
