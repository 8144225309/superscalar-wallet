/**
 * @author Junaid Atari
 * @link https://gist.github.com/blacksmoke26/65f35ee824674e00d858047e852bd270
 *
 * Modified by AgainPsychoX to use TypeScript and `use-debounce` package.
 * Modified by Shahana to remove `use-debounce` package and use enums.
 */

/**
 * use-breakpoint — Bootstrap-aligned responsive viewport hook.
 *
 * What it provides
 *   The current viewport breakpoint enum (XS / SM / MD / LG / XL),
 *   keyed off window.innerWidth at the same thresholds Bootstrap
 *   uses (576 / 768 / 992 / 1200 / 1400+).
 *
 * Why debounced
 *   resize fires dozens of times per drag. A 200ms debounce keeps
 *   re-renders manageable while the user resizes a window. Tests
 *   should use jest.useFakeTimers + vi.advanceTimersByTime to step
 *   past the debounce window.
 *
 * Side effects
 *   - Adds a window 'resize' listener on mount
 *   - Removes it on unmount
 *   - logs the new breakpoint via console.log on change (debug aid;
 *     the level-gated logger.service is the planned replacement)
 *
 * Return
 *   `Breakpoints` enum value. Components branch off it for things
 *   like "compact nav-pill font at XS" or "two-column at LG+".
 *
 * Test coverage
 *   use-breakpoint.test.ts (R8.20) pins the threshold map + debounce
 *   semantics (15 cases).
 */
import { useState, useEffect } from 'react';
import { Breakpoints } from '../utilities/constants';

const resolveBreakpoint = (width: number): Breakpoints => {
  if (width < 576) return Breakpoints.XS;
  if (width < 768) return Breakpoints.SM;
  if (width < 992) return Breakpoints.MD;
  if (width < 1200) return Breakpoints.LG;
  if (width < 1440) return Breakpoints.XL;
  return Breakpoints.XXL;
};

const useBreakpoint = () => {
  const [size, setSize] = useState(() => resolveBreakpoint(window.innerWidth));

  useEffect(() => {
    const update = () => {
      return setTimeout(() => {
        return setSize(resolveBreakpoint(window.innerWidth));
      }, 200);
    };

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return size;
};

export default useBreakpoint;
