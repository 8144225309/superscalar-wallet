import { useEffect } from 'react';
import { appStore } from '../store/appStore';
import { StoreWithManager } from '../store/store.type';

/**
 * use-injectreducer — lazy Redux reducer registration hook.
 *
 * What it provides
 *   On first mount of a component that uses a slice not in the base
 *   reducer set, calls `appStore.reducerManager.add(key, reducer)`
 *   and replaces the root reducer. Subsequent calls with the same
 *   key are no-ops (idempotency tracked in module-level
 *   `injectedReducers`).
 *
 * Why lazy injection
 *   appStore.tsx only ships `root` + `nodes` reducers at boot. The
 *   factories / bookkeeper / cln / factoryEvents slices are large
 *   and only matter on their own routes. Components mount them on
 *   demand via this hook so the base bundle stays small AND the
 *   initial Redux tree doesn't carry unused empty slices.
 *
 * Module-level state
 *   `injectedReducers: Record<string, boolean>` — process-global
 *   registry. Hot-reload safe because keys are stable strings.
 *
 * Args
 *   - `key`: slice name (e.g. 'factories', 'cln', 'bkpr')
 *   - `reducer`: the imported reducer for that slice
 *
 * Side effects
 *   - First call per key: mutates appStore + injectedReducers
 *   - Subsequent calls: no-op
 */
const injectedReducers: Record<string, boolean> = {};

export function useInjectReducer<Key extends string>(
  key: Key,
  reducer: any
) {
  useEffect(() => {
    const store = appStore as StoreWithManager;
    if (injectedReducers[key]) return;

    store.reducerManager.add(key, reducer);
    store.replaceReducer(store.reducerManager.reduce);
    injectedReducers[key] = true;
  }, [key, reducer]);
}
