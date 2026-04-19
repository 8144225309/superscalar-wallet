export type CoordinatorNetwork = 'bitcoin' | 'signet' | 'testnet4';

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
  vouchAutoRefresh: boolean;
  browseCacheTtlMin: number;
}

export const DEFAULT_COORDINATORS: Record<CoordinatorNetwork, string> = {
  signet: 'npub1zgqcy07tv2gqupug3mrufce9nsjccvta6ynawle54wk2ma7vw96s3wxurq',
  testnet4: 'npub1dh4rzrpttf94pajglfqrvad2lcaqxncurj4p3keaj43vqrsdvw3q8aq8qr',
  bitcoin: 'npub103gc9tm8apf56w56mtcw5r5crz84d6hldk06vkmw8ulaht6ddu8qd7vw4j',
};

export const DEFAULT_RELAYS: string[] = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.wine',
];

export function buildDefaultSettings(): RendezvousSettings {
  return {
    version: 1,
    coordinators: {
      signet: [
        { npub: DEFAULT_COORDINATORS.signet, enabled: true, isDefault: true, label: 'soup-rendezvous (signet)' },
      ],
      testnet4: [
        { npub: DEFAULT_COORDINATORS.testnet4, enabled: true, isDefault: true, label: 'soup-rendezvous (testnet4)' },
      ],
      bitcoin: [
        { npub: DEFAULT_COORDINATORS.bitcoin, enabled: true, isDefault: true, label: 'soup-rendezvous (mainnet)' },
      ],
    },
    relays: DEFAULT_RELAYS.map(url => ({ url, enabled: true, isDefault: true })),
    maxEntries: 500,
    tierCaps: { channel: 500, utxo: 500, peer: 100 },
    showPeerTier: { signet: true, testnet4: true, bitcoin: false },
    vouchRefreshMin: 60,
    vouchAutoRefresh: false,
    browseCacheTtlMin: 5,
  };
}
