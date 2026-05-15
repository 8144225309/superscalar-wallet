import { type Event } from 'nostr-tools/pure';
import type { CoordinatorNetwork } from './rendezvous-settings.type.js';

/**
 * Frontend → backend request shape for preparing a kind-4 DM to the
 * soup-rendezvous coordinator.
 */
export interface PrepareVouchEventRequest {
  network: CoordinatorNetwork;
  lnNodeId: string;
}

/**
 * Backend → frontend response shape. The frontend publishes the
 * signedEvent via its own SimplePool — backend does not maintain
 * a relay connection pool.
 */
export interface PrepareVouchEventResponse {
  signedEvent: Event;
  coordinator: {
    npub: string;
    pubkeyHex: string;
    label?: string;
  };
  relays: string[];
  lspNpub: string;
  challenge: string;
}

/**
 * One entry of the proof_multi.proofs array. Phase 3 only emits
 * proof_of_channel; proof_of_utxo and proof_of_peer will follow as
 * separate proof types per WALLET_INTEGRATION.md §9.
 */
export interface ProofOfChannelEntry {
  type: 'proof_of_channel';
  node_id: string;
  zbase: string;
  challenge: string;
}

export interface ProofMultiPayload {
  type: 'proof_multi';
  proofs: ProofOfChannelEntry[];
}
