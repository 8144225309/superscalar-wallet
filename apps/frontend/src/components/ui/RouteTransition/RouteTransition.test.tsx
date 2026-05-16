import { screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../utilities/test-utilities/mockStore';
import RouteTransition from './RouteTransition';

describe('RouteTransition', () => {
  it('renders without crashing', async () => {
    await renderWithProviders(<RouteTransition />, {initialRoute: ['/'] });
    expect(screen.getByTestId('route-transition')).toBeInTheDocument();
  });

  it('applies correct initial animation state', async () => {
    await renderWithProviders(<RouteTransition />, { initialRoute: ['/'] });
    const motionDiv = screen.getByTestId('route-transition');
    expect(motionDiv).toHaveStyle({ opacity: '0' });
    // The previous assertion checked for `translateY(20px)`. That matched
    // the original component's `initial={{ y: 20, opacity: 0 }}` but the
    // y-axis animation was removed (commit 73302e8 "Fix factories page
    // scroll: remove overflow-hidden from route transition"); only opacity
    // remains. The check is dropped rather than kept-as-skipped because
    // the behavior it asserted is intentionally gone.
  });

  it('handles route transitions correctly', async () => {
    const { router } = await renderWithProviders(<RouteTransition />, { initialRoute: ['/cln'] });
    
    // Verify initial route renders
    expect(screen.getByTestId('route-transition')).toBeInTheDocument();
    expect(screen.getByTestId('cln-container')).toBeInTheDocument();

    // Navigate to new route
    await act(async () => { 
      await router.navigate('/bookkeeper');
    });

    // Verify new route content renders (check for bookkeeper-specific content)
    await waitFor(() => {
      expect(screen.getByTestId('bookkeeper-dashboard-container')).toBeInTheDocument();
    }, { timeout: 1000 });
    
    // Verify old route is gone
    expect(screen.queryByTestId('cln-container')).not.toBeInTheDocument();
  });

  it('scrolls to top on route change', async () => {
    const mockScrollTo = window.scrollTo as jest.Mock;
    mockScrollTo.mockImplementation(() => {});
  
    const { router } = await renderWithProviders(<RouteTransition />, { initialRoute: ['/'] });
  
    // Initial render should trigger scroll
    expect(mockScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  
    mockScrollTo.mockClear();
  
    // Route change should trigger scroll again
    await act(async () => { await router.navigate('/bookkeeper') });
  
    expect(mockScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
