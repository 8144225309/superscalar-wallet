export type CoordinatorNetwork = 'bitcoin' | 'signet' | 'testnet4';

export type VouchTier = 'channel' | 'utxo' | 'peer';

export interface CoordinatorEntry {
  npub: string;
  enabled: boolean;
  isDefault: boolean;
  label?: string;
}

export interface RelayEntry {
  url: string;
  enabled: boolean;
  isDefault: boolean;
}

export interface TierCaps {
  channel: number;
  utxo: number;
  peer: number;
}

export interface RendezvousSettings {
  version: 1;
  coordinators: Record<CoordinatorNetwork, CoordinatorEntry[]>;
  relays: RelayEntry[];
  maxEntries: number;
  tierCaps: TierCaps;
  showPeerTier: Partial<Record<CoordinatorNetwork, boolean>>;
  vouchRefreshMin: number;
  browseCacheTtlMin: number;
}

/** A vouch event normalized into the wallet's working shape. */
export interface Vouch {
  /** LN node pubkey to dial — primary key for dedup. */
  ln_node_id: string;
  /** Optional host-declared addresses (only present when host isn't in BOLT-7 gossip). */
  ln_addresses?: string[];
  tier: VouchTier;
  /** Coordinator npub that issued this vouch. */
  coordinator: string;
  /** Host's Nostr pubkey hex (the d-tag). */
  host_pubkey: string;
  /** Unix seconds. */
  verified_at: number;
  /** Unix seconds. */
  expires_at: number;
  /** Status from the event content; we only ever store `active` here (revokes are filtered out). */
  status: 'active';
}

/** Placeholder shape for browse results — wired in a later PR once plugin RPC ships. */
export interface BrowseFactory {
  instance_id: string;
  params: Record<string, any>;
  slots_open: number;
  slots_total: number;
  lifecycle: string;
  expiry_block?: number;
  lsp_fee_sat?: number;
  lsp_fee_ppm?: number;
}

export interface VouchListSlice {
  isLoading: boolean;
  vouches: Vouch[];
  /** Per-coordinator stats so the user can see which coordinators returned what. */
  byCoordinator: Record<string, { tier: Record<VouchTier, number>; total: number }>;
  /** Errors per coordinator npub (one query failing should not blank the list). */
  errors: Record<string, string>;
  /** Last successful fetch unix-ms. */
  lastFetchedAt?: number;
}

export interface BrowseCacheEntry {
  factories: BrowseFactory[];
  fetchedAt: number;
  error?: string;
}

export interface RendezvousState {
  settings: RendezvousSettings | null;
  settingsLoading: boolean;
  settingsError?: string;
  vouchList: VouchListSlice;
  /** browseCache keyed by ln_node_id. Empty for now — populated once factory-browse RPC ships. */
  browseCache: Record<string, BrowseCacheEntry>;
}
