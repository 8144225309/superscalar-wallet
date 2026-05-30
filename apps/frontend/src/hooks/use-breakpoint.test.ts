import { renderHook, act } from '@testing-library/react';
import useBreakpoint from './use-breakpoint';
import { Breakpoints } from '../utilities/constants';

/* The hook reads window.innerWidth and listens for 'resize' (with a
 * 200ms debounce timer). The Jest jsdom environment lets us mutate
 * window.innerWidth + dispatch resize directly. */
function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('useBreakpoint', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [500, Breakpoints.XS],   // <576
    [575, Breakpoints.XS],
    [576, Breakpoints.SM],   // <768
    [767, Breakpoints.SM],
    [768, Breakpoints.MD],   // <992
    [991, Breakpoints.MD],
    [992, Breakpoints.LG],   // <1200
    [1199, Breakpoints.LG],
    [1200, Breakpoints.XL],  // <1440
    [1439, Breakpoints.XL],
    [1440, Breakpoints.XXL], // >=1440
    [3840, Breakpoints.XXL],
  ])('width %i → %s', (width, expected) => {
    setViewport(width);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe(expected);
  });

  it('reacts to resize after the 200ms debounce', () => {
    setViewport(500);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe(Breakpoints.XS);

    act(() => {
      setViewport(1500);
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe(Breakpoints.XXL);
  });

  it('does NOT update before the 200ms debounce window elapses', () => {
    setViewport(500);
    const { result } = renderHook(() => useBreakpoint());

    act(() => {
      setViewport(1500);
      jest.advanceTimersByTime(150);  // < 200ms
    });
    /* Still XS because debounce hasn't fired */
    expect(result.current).toBe(Breakpoints.XS);
  });

  it('cleans up the resize listener on unmount', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useBreakpoint());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeSpy.mockRestore();
  });
});
