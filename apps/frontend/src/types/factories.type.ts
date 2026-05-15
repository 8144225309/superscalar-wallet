export enum FactoryLifecycle {
  INIT = 'init',
  ACTIVE = 'active',
  DYING = 'dying',
  EXPIRED = 'expired',
}

export enum FactoryCeremony {
  IDLE = 'idle',
  PROPOSED = 'proposed',
  NONCES_COLLECTED = 'nonces_collected',
  PSIGS_COLLECTED = 'psigs_collected',
  COMPLETE = 'complete',
  ROTATING = 'rotating',
  ROTATE_COMPLETE = 'rotate_complete',
  REVOKED = 'revoked',
  FAILED = 'failed',
}

export type FactoryChannel = {
  channel_id: string;
  leaf_index: number;
  leaf_side: number;
  funding_txid?: string;
  funding_outnum?: number;
};

export type Factory = {
  instance_id: string;
  is_lsp: boolean;
  n_clients: number;
  epoch: number;
  n_channels: number;
  lifecycle: FactoryLifecycle;
  ceremony: FactoryCeremony;
  max_epochs: number;
  creation_block: number;
  expiry_block: number;
  rotation_in_progress: boolean;
  n_breach_epochs: number;
  dist_tx_status: string;
  tree_nodes: number;
  funding_txid: string;
  funding_outnum: number;
  channels: FactoryChannel[];
};

export type FactoryAllocation = {
  node_id: string;
  capacity_sat: number;
};

export type FactoryCreateOptions = {
  leaf_arity?: number;
  leaf_channel_type?: 'pseudo-spilman' | 'ln-penalty';
  epoch_count?: number;
  lifetime_blocks?: number;
  dying_period_blocks?: number;
  block_early_count?: number;
  lsp_fee_sat?: number;
  lsp_fee_ppm?: number;
  allocations?: FactoryAllocation[];
};

export type FactoryLocalPrefs = {
  label?: string;
  autoHostNext: boolean;
  autoFinalizeOnDying: boolean;
  autoRotatePeriodically: boolean;
  autoAcceptJoiners: boolean;
  banlist: string[];
  allowBolt12: boolean;
  allowAmp: boolean;
  htlcMinSat: number;
  htlcMaxSat: number;
  advertiseOnNostr: boolean;
};

export type FactoryCreateResponse = {
  instance_id: string;
  n_clients: number;
  ceremony: FactoryCeremony;
};

export type FactoryRotateResponse = {
  instance_id: string;
  old_epoch: number;
  new_epoch: number;
  ceremony: FactoryCeremony;
};

export type FactoryCloseResponse = {
  instance_id: string;
  status: string;
};

export type FactoryForceCloseTransaction = {
  node_idx: number;
  type: string;
  txid: string;
  raw_tx: string;
  tx_len: number;
};

export type FactoryForceCloseResponse = {
  instance_id: string;
  n_signed_txs: number;
  status: string;
  transactions: FactoryForceCloseTransaction[];
};

export type FactoryCheckBreachResponse = {
  burn_tx: string;
  burn_tx_len: number;
  epoch: number;
  status: string;
};

export type FactoriesState = {
  factoryList: {
    isLoading: boolean;
    factories: Factory[];
    error?: any;
  };
  selectedFactory: Factory | null;
  actionStatus: {
    action: string | null;
    status: 'idle' | 'pending' | 'success' | 'error';
    message: string;
    data?: any;
  };
};
