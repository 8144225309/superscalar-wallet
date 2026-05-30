import reducer, {
  setSettingsLoading,
  setSettings,
  setSettingsError,
  setVouchList,
  setBrowseCacheEntry,
  clearBrowseCache,
  bumpVouchRefreshTrigger,
  clearRendezvousStore,
} from './rendezvousSlice';
import {
  defaultRendezvousState,
  selectVouchCounts,
  selectMergedVouchList,
  selectEnabledRelays,
} from './rendezvousSelectors';
import type { Vouch, RendezvousSettings } from '../types/rendezvous.type';

const MINIMAL_SETTINGS: RendezvousSettings = {
  relays: [
    { url: 'wss://relay.example', enabled: true, isDefault: true },
    { url: 'wss://disabled.example', enabled: false, isDefault: false },
  ],
  coordinators: { bitcoin: [], signet: [], testnet4: [] },
  tierCaps: { channel: 10, utxo: 10, peer: 10 },
  includePeer: false,
  maxEntries: 100,
} as unknown as RendezvousSettings;

function vouch(ln: string, tier: 'channel' | 'utxo' | 'peer', verified_at: number): Vouch {
  return {
    ln_node_id: ln, tier, coordinator: 'npub1xx',
    host_pubkey: 'aa', verified_at, expires_at: verified_at + 86400,
    status: 'active' as const,
  };
}

describe('rendezvousSlice reducers', () => {
  it('starts with the documented default state', () => {
    const s = reducer(undefined, { type: '@@INIT' } as any);
    expect(s).toEqual(defaultRendezvousState);
  });

  it('setSettingsLoading(true) flips flag and clears prior error', () => {
    const s0 = reducer(undefined, setSettingsError('boom'));
    expect(s0.settingsError).toBe('boom');
    const s1 = reducer(s0, setSettingsLoading(true));
    expect(s1.settingsLoading).toBe(true);
    expect(s1.settingsError).toBeUndefined();
  });

  it('setSettings stores payload and resolves loading/error', async () => {
    const s = reducer(undefined, setSettings(MINIMAL_SETTINGS));
    expect(s.settings).toBe(MINIMAL_SETTINGS);
    expect(s.settingsLoading).toBe(false);
    expect(s.settingsError).toBeUndefined();
  });

  it('setSettingsError stores message and resolves loading', () => {
    const s = reducer(undefined, setSettingsError('Load failed'));
    expect(s.settingsError).toBe('Load failed');
    expect(s.settingsLoading).toBe(false);
  });

  it('setVouchList writes vouches + byCoordinator + errors + lastFetchedAt', () => {
    const v1 = vouch('02aa', 'channel', 1000);
    const s = reducer(undefined, setVouchList({
      vouches: [v1],
      byCoordinator: { 'npub1xx': { tier: { channel: 1, utxo: 0, peer: 0 }, total: 1 } },
      errors: {},
    }));
    expect(s.vouchList.vouches).toEqual([v1]);
    expect(s.vouchList.isLoading).toBe(false);
    expect(typeof s.vouchList.lastFetchedAt).toBe('number');
    expect(s.vouchList.byCoordinator['npub1xx'].total).toBe(1);
  });

  it('setBrowseCacheEntry stores per-lnNodeId entries', () => {
    const entry = { snapshot_block: 100, factories: [] } as any;
    const s = reducer(undefined, setBrowseCacheEntry({ lnNodeId: '02aa', entry }));
    expect(s.browseCache['02aa']).toBe(entry);
  });

  it('clearBrowseCache wipes the cache map', () => {
    const entry = { snapshot_block: 100, factories: [] } as any;
    const s1 = reducer(undefined, setBrowseCacheEntry({ lnNodeId: '02aa', entry }));
    const s2 = reducer(s1, clearBrowseCache());
    expect(s2.browseCache).toEqual({});
  });

  it('bumpVouchRefreshTrigger increments monotonically from 0', () => {
    let s = reducer(undefined, { type: '@@INIT' } as any);
    s = reducer(s, bumpVouchRefreshTrigger());
    s = reducer(s, bumpVouchRefreshTrigger());
    s = reducer(s, bumpVouchRefreshTrigger());
    expect(s.vouchRefreshTrigger).toBe(3);
  });

  it('clearRendezvousStore resets to defaultRendezvousState', () => {
    const s1 = reducer(undefined, setSettings(MINIMAL_SETTINGS));
    const s2 = reducer(s1, clearRendezvousStore());
    expect(s2).toEqual(defaultRendezvousState);
  });
});

describe('rendezvousSelectors', () => {
  it('selectVouchCounts buckets by tier', () => {
    const s = reducer(undefined, setVouchList({
      vouches: [
        vouch('a', 'channel', 1),
        vouch('b', 'channel', 2),
        vouch('c', 'utxo', 3),
        vouch('d', 'peer', 4),
      ],
      byCoordinator: {},
      errors: {},
    }));
    const counts = selectVouchCounts({ rendezvous: s });
    expect(counts).toEqual({ channel: 2, utxo: 1, peer: 1 });
  });

  it('selectMergedVouchList orders by tier strength (channel > utxo > peer)', () => {
    const s = reducer(undefined, setVouchList({
      vouches: [
        vouch('p', 'peer', 100),
        vouch('c', 'channel', 50),
        vouch('u', 'utxo', 75),
      ],
      byCoordinator: {},
      errors: {},
    }));
    const merged = selectMergedVouchList({ rendezvous: s });
    expect(merged.map(v => v.ln_node_id)).toEqual(['c', 'u', 'p']);
  });

  it('selectMergedVouchList breaks tier ties by verified_at DESC', () => {
    const s = reducer(undefined, setVouchList({
      vouches: [
        vouch('older', 'channel', 100),
        vouch('newer', 'channel', 200),
      ],
      byCoordinator: {},
      errors: {},
    }));
    const merged = selectMergedVouchList({ rendezvous: s });
    expect(merged.map(v => v.ln_node_id)).toEqual(['newer', 'older']);
  });

  it('selectEnabledRelays returns only the enabled URLs', () => {
    const s = reducer(undefined, setSettings(MINIMAL_SETTINGS));
    const enabled = selectEnabledRelays({ rendezvous: s });
    expect(enabled).toEqual(['wss://relay.example']);
  });

  it('selectEnabledRelays returns [] when settings are null', () => {
    const s = reducer(undefined, { type: '@@INIT' } as any);
    expect(selectEnabledRelays({ rendezvous: s })).toEqual([]);
  });
});
