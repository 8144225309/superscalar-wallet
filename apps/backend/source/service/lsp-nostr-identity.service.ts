import * as fs from 'fs';
import * as path from 'path';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type EventTemplate,
  type Event,
} from 'nostr-tools/pure';
import { nip19, nip44 } from 'nostr-tools';
import { logger } from '../shared/logger.js';

const IDENTITY_FILE = './lsp-nostr-identity.json';

interface PersistedIdentity {
  version: 1;
  nsec_hex: string;
  pubkey_hex: string;
  created_at: number;
}

/**
 * LSP Nostr identity for soup-rendezvous proof DMs.
 *
 * Distinct from any LN node identity: this key signs kind-4 DMs to the
 * coordinator (proof_multi requests) and labels published vouches with
 * the host's d-tag. Compromise allows publishing vouches in the host's
 * name but does NOT grant LN-node impersonation (the proof itself
 * carries an LN signmessage signature from CLN).
 */
export class LspNostrIdentityService {
  private configPath: string;
  private secretKey: Uint8Array | null = null;
  private pubkeyHex: string = '';

  constructor(configPath?: string) {
    this.configPath = configPath || IDENTITY_FILE;
  }

  load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedIdentity;
        if (parsed.version !== 1 || !parsed.nsec_hex || !parsed.pubkey_hex) {
          throw new Error('invalid identity file format');
        }
        const sk = Buffer.from(parsed.nsec_hex, 'hex');
        if (sk.length !== 32) {
          throw new Error('nsec_hex must decode to 32 bytes');
        }
        this.secretKey = new Uint8Array(sk);
        this.pubkeyHex = parsed.pubkey_hex;
        logger.info(
          'Loaded LSP Nostr identity: ' +
            this.pubkeyHex.substring(0, 12) +
            '... (npub ' +
            this.getNpub().substring(0, 16) +
            '...)',
        );
        return;
      }
    } catch (error: any) {
      logger.error('Error loading LSP Nostr identity: ' + (error.message || error));
      throw error;
    }
    this.generate();
  }

  private generate(): void {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const data: PersistedIdentity = {
      version: 1,
      nsec_hex: Buffer.from(sk).toString('hex'),
      pubkey_hex: pk,
      created_at: Math.floor(Date.now() / 1000),
    };
    this.persist(data);
    this.secretKey = sk;
    this.pubkeyHex = pk;
    logger.warn('Generated new LSP Nostr identity: ' + pk + ' (npub ' + nip19.npubEncode(pk) + ')');
  }

  private persist(data: PersistedIdentity): void {
    const resolved = path.resolve(this.configPath);
    const dir = path.dirname(resolved);
    const tmp = path.join(dir, '.lsp-nostr-identity.tmp.' + process.pid + '.json');
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, resolved);
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {
      /* no-op on Windows; file perms not enforced there */
    }
  }

  getPubkeyHex(): string {
    if (!this.pubkeyHex) throw new Error('LSP Nostr identity not loaded');
    return this.pubkeyHex;
  }

  getNpub(): string {
    return nip19.npubEncode(this.getPubkeyHex());
  }

  signEvent(template: EventTemplate): Event {
    if (!this.secretKey) throw new Error('LSP Nostr identity not loaded');
    return finalizeEvent(template, this.secretKey);
  }

  encryptToPubkey(recipientPubkeyHex: string, plaintext: string): string {
    if (!this.secretKey) throw new Error('LSP Nostr identity not loaded');
    const conversationKey = nip44.v2.utils.getConversationKey(this.secretKey, recipientPubkeyHex);
    return nip44.v2.encrypt(plaintext, conversationKey);
  }

  decryptFromPubkey(senderPubkeyHex: string, ciphertext: string): string {
    if (!this.secretKey) throw new Error('LSP Nostr identity not loaded');
    const conversationKey = nip44.v2.utils.getConversationKey(this.secretKey, senderPubkeyHex);
    return nip44.v2.decrypt(ciphertext, conversationKey);
  }
}
