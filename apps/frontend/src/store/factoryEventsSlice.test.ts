import reducer, {
  factoryEventReceived,
  factoryEventsCatchupComplete,
  factoryEventsClear,
  selectLastSeenEventId,
  selectRecentFactoryEvents,
  selectFactoryEventsByType,
  FactoryEvent,
} from './factoryEventsSlice';

function ev(event_id: number, type = 'factory_propose_received', payload: any = {}): FactoryEvent {
  return { event_id, type, factory_iid_hex: 'aa', payload, created_at: 1700000000 + event_id };
}

describe('factoryEventsSlice', () => {
  it('starts with empty events + zero cursor + catchup false', () => {
    const s = reducer(undefined, { type: '@@INIT' } as any);
    expect(s.lastSeenEventId).toBe(0);
    expect(s.recentEvents).toEqual([]);
    expect(s.catchupComplete).toBe(false);
  });

  it('factoryEventReceived prepends the new event and bumps the cursor', () => {
    const s1 = reducer(undefined, factoryEventReceived(ev(1, 'a')));
    expect(s1.lastSeenEventId).toBe(1);
    expect(s1.recentEvents.map((e) => e.event_id)).toEqual([1]);
    const s2 = reducer(s1, factoryEventReceived(ev(2, 'b')));
    expect(s2.lastSeenEventId).toBe(2);
    expect(s2.recentEvents.map((e) => e.event_id)).toEqual([2, 1]);
  });

  it('does not lower the cursor on an out-of-order older event', () => {
    const s1 = reducer(undefined, factoryEventReceived(ev(5)));
    const s2 = reducer(s1, factoryEventReceived(ev(3)));
    expect(s2.lastSeenEventId).toBe(5);
    expect(s2.recentEvents.map((e) => e.event_id)).toEqual([3, 5]);
  });

  it('dedupes by event_id (re-delivery moves event to front, not duplicated)', () => {
    const s1 = reducer(undefined, factoryEventReceived(ev(1)));
    const s2 = reducer(s1, factoryEventReceived(ev(2)));
    const s3 = reducer(s2, factoryEventReceived(ev(1, 'updated')));
    expect(s3.recentEvents.length).toBe(2);
    expect(s3.recentEvents[0].event_id).toBe(1);
    expect(s3.recentEvents[0].type).toBe('updated');
    expect(s3.recentEvents[1].event_id).toBe(2);
  });

  it('caps recentEvents at 50 entries (oldest evicted)', () => {
    let s = reducer(undefined, { type: '@@INIT' } as any);
    for (let i = 1; i <= 60; i++) {
      s = reducer(s, factoryEventReceived(ev(i)));
    }
    expect(s.recentEvents.length).toBe(50);
    expect(s.recentEvents[0].event_id).toBe(60);
    expect(s.recentEvents[49].event_id).toBe(11);
  });

  it('factoryEventsCatchupComplete flips the flag and can bump cursor forward', () => {
    const s0 = reducer(undefined, { type: '@@INIT' } as any);
    const s1 = reducer(s0, factoryEventsCatchupComplete({ lastSeenEventId: 42 }));
    expect(s1.catchupComplete).toBe(true);
    expect(s1.lastSeenEventId).toBe(42);
  });

  it('factoryEventsCatchupComplete does not lower a higher cursor', () => {
    const s1 = reducer(undefined, factoryEventReceived(ev(100)));
    const s2 = reducer(s1, factoryEventsCatchupComplete({ lastSeenEventId: 50 }));
    expect(s2.lastSeenEventId).toBe(100);
    expect(s2.catchupComplete).toBe(true);
  });

  it('factoryEventsClear empties the buffer but keeps the cursor + flag', () => {
    const s1 = reducer(undefined, factoryEventReceived(ev(7)));
    const s2 = reducer(s1, factoryEventsCatchupComplete({ lastSeenEventId: 7 }));
    const s3 = reducer(s2, factoryEventsClear());
    expect(s3.recentEvents).toEqual([]);
    expect(s3.lastSeenEventId).toBe(7);
    expect(s3.catchupComplete).toBe(true);
  });

  it('selectors return cursor + recent events + by-type filter', () => {
    let s = reducer(undefined, factoryEventReceived(ev(1, 'a')));
    s = reducer(s, factoryEventReceived(ev(2, 'b')));
    s = reducer(s, factoryEventReceived(ev(3, 'a')));
    const root = { factoryEvents: s };
    expect(selectLastSeenEventId(root)).toBe(3);
    expect(selectRecentFactoryEvents(root).map((e) => e.event_id)).toEqual([3, 2, 1]);
    expect(selectFactoryEventsByType('a')(root).map((e) => e.event_id)).toEqual([3, 1]);
  });
});
