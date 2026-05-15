import * as crypto from 'crypto';
import { nip19 } from 'nostr-tools';
import { type EventTemplate } from 'nostr-tools/pure';
import { logger } from '../shared/logger.js';
import { LspNostrIdentityService } from './lsp-nostr-identity.service.js';
import { NodeManager } from './node-manager.service.js';
import { RendezvousSettingsService } from './rendezvous-settings.service.js';
import {
  PrepareVouchEventRequest,
  PrepareVouchEventResponse,
  ProofMultiPayload,
} from '../models/vouch.type.js';

const COMPRESSED_PUBKEY_RE = /^0[23][0-9a-fA-F]{64}$/;
const KIND_ENCRYPTED_DM = 4;

/**
 * Prepares (but does not publish) kind-4 proof_multi DMs to the
 * soup-rendezvous coordinator. The frontend takes the signed event
 * returned here and publishes it via its existing SimplePool — keeping
 * the backend free of WebSocket relay state.
 *
 * Phase 3 supports proof-of-channel only. proof-of-utxo and proof-of-peer
 * can be added by extending buildProofMulti() with additional proofs.
 */
export class VouchPublisherService {
  private identity: LspNostrIdentityService;
  private nodeManager: NodeManager;
  private settings: RendezvousSettingsService;

  constructor(
    identity: LspNostrIdentityService,
    nodeManager: NodeManager,
    settings: RendezvousSettingsService,
  ) {
    this.identity = identity;
    this.nodeManager = nodeManager;
    this.settings = settings;
  }

  async prepareVouchEvent(req: PrepareVouchEventRequest): Promise<PrepareVouchEventResponse> {
    const { network, lnNodeId } = req;

    if (!COMPRESSED_PUBKEY_RE.test(lnNodeId)) {
      throw new Error('lnNodeId is not a valid compressed secp256k1 pubkey hex');
    }

    const settings = this.settings.load();
    const coordinators = settings.coordinators[network] || [];
    const coord = coordinators.find(c => c.enabled);
    if (!coord) {
      throw new Error('No enabled coordinator configured for network: ' + network);
    }

    let coordPubkeyHex: string;
    try {
      const decoded = nip19.decode(coord.npub);
      if (decoded.type !== 'npub') {
        throw new Error('coordinator entry is not an npub');
      }
      coordPubkeyHex = decoded.data as string;
    } catch (err: any) {
      throw new Error('Failed to decode coordinator npub: ' + (err.message || err));
    }

    const enabledRelays = settings.relays.filter(r => r.enabled).map(r => r.url);
    if (enabledRelays.length === 0) {
      throw new Error('No enabled relays configured');
    }

    const challenge = this.buildChallenge('proof-of-channel', coord.npub);

    const lnSvc = this.nodeManager.getActiveService();
    if (!lnSvc) {
      throw new Error('No active Lightning service for signmessage');
    }
    const { zbase } = await lnSvc.signMessage(challenge);

    const proofMulti: ProofMultiPayload = {
      type: 'proof_multi',
      proofs: [
        {
          type: 'proof_of_channel',
          node_id: lnNodeId,
          zbase,
          challenge,
        },
      ],
    };

    const ciphertext = this.identity.encryptToPubkey(coordPubkeyHex, JSON.stringify(proofMulti));

    const template: EventTemplate = {
      kind: KIND_ENCRYPTED_DM,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', coordPubkeyHex]],
      content: ciphertext,
    };
    const signedEvent = this.identity.signEvent(template);

    logger.info(
      'Prepared vouch proof DM: lsp=' +
        this.identity.getPubkeyHex().substring(0, 12) +
        '... -> coord=' +
        coordPubkeyHex.substring(0, 12) +
        '... (network=' +
        network +
        ', lnNodeId=' +
        lnNodeId.substring(0, 12) +
        '...)',
    );

    return {
      signedEvent,
      coordinator: {
        npub: coord.npub,
        pubkeyHex: coordPubkeyHex,
        label: coord.label,
      },
      relays: enabledRelays,
      lspNpub: this.identity.getNpub(),
      challenge,
    };
  }

  /**
   * soup-rendezvous challenge format per WALLET_INTEGRATION.md §9:
   *   soup-rendezvous:proof-of-<tier>:v0:<coord-npub>:<16-hex-nonce>:<unix-ts>
   */
  private buildChallenge(
    tier: 'proof-of-channel' | 'proof-of-utxo' | 'proof-of-peer',
    coordNpub: string,
  ): string {
    const nonce = crypto.randomBytes(8).toString('hex'); // 16 hex chars
    const ts = Math.floor(Date.now() / 1000);
    return 'soup-rendezvous:' + tier + ':v0:' + coordNpub + ':' + nonce + ':' + ts;
  }
}
