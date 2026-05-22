/* Session 5b/c (item 5): factory event stream hook.
 *
 * Per the offline-catchup constraint: the wallet might not be online when
 * an event fires (factory_propose_received, ceremony_complete, join_request_*,
 * etc.). The plugin persists every event into a durable event_log table and
 * exposes wallet-list-events-since for catchup.
 *
 * This hook is the frontend half:
 *   - On mount: read last_seen_event_id from localStorage (or call
 *     wallet-get-latest-event-id once to seed if absent).
 *   - Every 5s: call wallet-list-events-since(since=last_seen).
 *   - For each returned event, dispatch a Redux factoryEventReceived action.
 *   - Update last_seen_event_id to max_event_id from the response.
 *
 * Polling cadence (5s) is currently the same as the prior banner polls; the
 * win is the event-log-backed reliability — a wallet offline for 30 min
 * gets ALL events on next mount, not just the latest snapshot.
 *
 * Future upgrade path: backend Socket.IO push → drops polling cadence to 0
 * while keeping the same wallet-list-events-since reconnect path. */

import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { FactoriesService } from '../services/http.service';
import { factoryEventReceived, factoryEventsCatchupComplete } from '../store/factoryEventsSlice';

const STORAGE_KEY = 'superscalar.lastSeenFactoryEventId';
const POLL_MS = 5000;

export function useFactoryEventStream() {
  const dispatch = useDispatch();
  const lastSeenRef = useRef<number>(0);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const initFromStorage = (): number => {
      try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v ? parseInt(v, 10) || 0 : 0;
      } catch {
        return 0;
      }
    };

    const saveLastSeen = (id: number) => {
      try {
        localStorage.setItem(STORAGE_KEY, String(id));
      } catch {
        /* localStorage unavailable; in-memory is fine */
      }
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const since = lastSeenRef.current;
        const r: any = await FactoriesService.listEventsSince(since, 500);
        const events: any[] = r?.events ?? [];
        const max = Number(r?.max_event_id ?? since);

        if (events.length > 0) {
          for (const e of events) {
            dispatch(factoryEventReceived(e));
          }
        }
        if (max > lastSeenRef.current) {
          lastSeenRef.current = max;
          saveLastSeen(max);
        }
        if (!initializedRef.current) {
          initializedRef.current = true;
          dispatch(factoryEventsCatchupComplete({ lastSeenEventId: max }));
        }
      } catch {
        /* Plugin may be down briefly during restart — silent retry on next tick */
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };

    // Seed last_seen from storage, then start polling.
    lastSeenRef.current = initFromStorage();
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [dispatch]);
}
