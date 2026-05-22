/* Session 5b/c: Redux slice for the factory event stream.
 *
 * Holds:
 *   - lastSeenEventId: monotonic cursor; mirrored to localStorage by the
 *     useFactoryEventStream hook so reconnects pick up the right window.
 *   - recentEvents: rolling buffer of the last 50 events for surfacing
 *     in the UI (notification toasts, "what's new" tray).
 *   - catchupComplete: false until the first poll returns; useful for
 *     hiding loading spinners.
 *
 * Components that care about specific event types subscribe via
 * useSelector and react to recentEvents diffs. Since events are
 * dispatched one-by-one, components can also subscribe to a
 * factoryEventReceived action via a custom middleware if they need
 * fire-and-forget side effects (e.g. invalidate a polling cache). */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type FactoryEvent = {
  event_id: number;
  type: string;
  factory_iid_hex: string | null;
  payload: any;
  created_at: number;
};

type FactoryEventsState = {
  lastSeenEventId: number;
  recentEvents: FactoryEvent[];
  catchupComplete: boolean;
};

const initialState: FactoryEventsState = {
  lastSeenEventId: 0,
  recentEvents: [],
  catchupComplete: false,
};

const MAX_RECENT = 50;

const factoryEventsSlice = createSlice({
  name: 'factoryEvents',
  initialState,
  reducers: {
    factoryEventReceived(state, action: PayloadAction<FactoryEvent>) {
      const ev = action.payload;
      if (ev.event_id > state.lastSeenEventId) {
        state.lastSeenEventId = ev.event_id;
      }
      // Prepend, cap, dedupe by event_id.
      const without = state.recentEvents.filter((e) => e.event_id !== ev.event_id);
      state.recentEvents = [ev, ...without].slice(0, MAX_RECENT);
    },
    factoryEventsCatchupComplete(state, action: PayloadAction<{ lastSeenEventId: number }>) {
      state.catchupComplete = true;
      if (action.payload.lastSeenEventId > state.lastSeenEventId) {
        state.lastSeenEventId = action.payload.lastSeenEventId;
      }
    },
    factoryEventsClear(state) {
      state.recentEvents = [];
    },
  },
});

export const { factoryEventReceived, factoryEventsCatchupComplete, factoryEventsClear } =
  factoryEventsSlice.actions;

export const selectLastSeenEventId = (s: { factoryEvents: FactoryEventsState }) =>
  s.factoryEvents.lastSeenEventId;
export const selectRecentFactoryEvents = (s: { factoryEvents: FactoryEventsState }) =>
  s.factoryEvents.recentEvents;
export const selectFactoryEventsByType = (type: string) =>
  (s: { factoryEvents: FactoryEventsState }) =>
    s.factoryEvents.recentEvents.filter((e) => e.type === type);

export default factoryEventsSlice.reducer;
