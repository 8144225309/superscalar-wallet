export interface NodeProfile {
  id: string;
  label: string;
  pubkey: string;
  wsHost: string;
  wsPort: number;
  network?: string;
  alias?: string;
  blockheight?: number;
  lastSeen?: number;
}

export interface ProfileHealth {
  profileId: string;
  alive: boolean;
  alias?: string;
  error?: string;
}

export interface NodesState {
  isLoading: boolean;
  profiles: NodeProfile[];
  activeProfileId: string | null;
  isConnected: boolean;
  hasFactoryPlugin: boolean;
  isSwitching: boolean;
  isDiscovering: boolean;
  error: any;
  profileHealth: ProfileHealth[];
}
