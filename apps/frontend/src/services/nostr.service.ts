import { SimplePool, nip19, type Event as NostrEvent, type Filter } from 'nostr-tools';
import {
  CoordinatorEntry,
  TierCaps,
  Vouch,
  VouchTier,
} from '../types/rendezvous.type';
import logger from './logger.service';

const VOUCH_KIND = 38101;
const TIERS_DEFAULT: VouchTier[] = ['channel', 'utxo'];
const TIER_RANK: Record<VouchTier, number> = { channel: 0, utxo: 1, peer: 2 };
const QUERY_MAX_WAIT_MS = 8000;
const HEX_PUBKEY_RE = /^0[23][0-9a-fA-F]{64}$/;

export interface FetchVouchesOptions {
  /** Cap per tier; weaker tiers truncated harder. */
  tierCaps: TierCaps;
  /** Hard cap after dedup. */
  maxEntries: number;
  /** Whether peer-tier should be queried at all. */
  includePeer: boolean;
}

export interface FetchVouchesResult {
  vouches: Vouch[];
  byCoordinator: Record<string, { tier: Record<VouchTier, number>; total: number }>;
  /** Per-coordinator (npub) error messages — a single failure does not blank the list. */
  errors: Record<string, string>;
}

interface RawVouch {
  event: NostrEvent;
  hostPubkey: string;
  lnNodeId: string;
  lnAddresses?: string[];
  tier: VouchTier;
  coordinatorNpub: string;
  verifiedAt: number;
  expiresAt: number;
}

let sharedPool: SimplePool | null = null;
function getPool(): SimplePool {
  if (!sharedPool) sharedPool = new SimplePool();
  return sharedPool;
}

function npubToHex(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') return null;
    return decoded.data as string;
  } catch {
    return null;
  }
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  const t = event.tags.find(tag => tag[0] === name);
  return t?.[1];
}

/**
 * Validate one raw vouch event against an accepted coordinator npub.
 * Returns null if any check fails — caller logs counts at the call site.
 */
function parseVouchEvent(event: NostrEvent, coordinatorNpub: string, expectedTier: VouchTier): RawVouch | null {
  if (event.kind !== VOUCH_KIND) return null;

  const tierTag = tagValue(event, 'l');
  if (tierTag !== expectedTier) return null;

  const hostPubkey = tagValue(event, 'd');
  if (!hostPubkey || hostPubkey.length !== 64) return null;

  const lnNodeIdTag = tagValue(event, 'ln_node_id');
  const expirationTag = tagValue(event, 'expiration');
  if (!expirationTag) return null;
  const expiresAt = Number(expirationTag);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;

  let parsedContent: any;
  try {
    parsedContent = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!parsedContent || typeof parsedContent !== 'object') return null;
  if (parsedContent.status !== 'active') return null;

  const lnNodeId: string | undefined = parsedContent.ln_node_id || lnNodeIdTag;
  if (!lnNodeId || !HEX_PUBKEY_RE.test(lnNodeId)) return null;

  const verifiedAt = Number(parsedContent.verified_at);
  const lnAddresses: string[] | undefined = Array.isArray(parsedContent.ln_addresses)
    ? parsedContent.ln_addresses.filter((a: any) => typeof a === 'string')
    : undefined;

  return {
    event,
    hostPubkey,
    lnNodeId,
    lnAddresses,
    tier: expectedTier,
    coordinatorNpub,
    verifiedAt: Number.isFinite(verifiedAt) ? verifiedAt : event.created_at,
    expiresAt,
  };
}

/**
 * Three-call tier-ordered fetch of vouches from N coordinators across M relays.
 * Strongest tier first so weak entries get truncated when capped.
 *
 * Each tier call is one `querySync` per relay set, with all enabled coordinator
 * authors unioned in a single filter — coordinators that fail simply don't
 * contribute events; we surface the empty result as an `errors[npub]`.
 */
export async function fetchVouches(
  coordinators: CoordinatorEntry[],
  relays: string[],
  opts: FetchVouchesOptions,
): Promise<FetchVouchesResult> {
  const result: FetchVouchesResult = {
    vouches: [],
    byCoordinator: {},
    errors: {},
  };

  if (coordinators.length === 0) {
    return result;
  }
  if (relays.length === 0) {
    for (const c of coordinators) result.errors[c.npub] = 'No relays configured';
    return result;
  }

  const npubToCoord = new Map<string, CoordinatorEntry>();
  const authorHexes: string[] = [];
  for (const c of coordinators) {
    const hex = npubToHex(c.npub);
    if (!hex) {
      result.errors[c.npub] = 'Invalid npub';
      continue;
    }
    npubToCoord.set(hex, c);
    authorHexes.push(hex);
    result.byCoordinator[c.npub] = { tier: { channel: 0, utxo: 0, peer: 0 }, total: 0 };
  }
  if (authorHexes.length === 0) return result;

  const tiers: VouchTier[] = opts.includePeer ? [...TIERS_DEFAULT, 'peer'] : TIERS_DEFAULT;

  // ln_node_id -> winning RawVouch (strongest tier wins; ties broken by recency)
  const winners = new Map<string, RawVouch>();
  const pool = getPool();

  for (const tier of tiers) {
    const cap = opts.tierCaps[tier];
    const filter: Filter = {
      kinds: [VOUCH_KIND],
      authors: authorHexes,
      '#l': [tier],
    };

    let events: NostrEvent[];
    try {
      events = await pool.querySync(relays, filter, { maxWait: QUERY_MAX_WAIT_MS });
    } catch (err: any) {
      logger.error('Nostr querySync failed for tier ' + tier + ': ' + (err?.message || err));
      // One tier failing should not blank the others — record it once across all coords.
      for (const npub of npubToCoord.values()) {
        result.errors[npub.npub] = (result.errors[npub.npub] || '') + 'tier ' + tier + ' failed; ';
      }
      continue;
    }

    // Sort newest-first so when we hit `cap`, we drop the oldest.
    events.sort((a, b) => b.created_at - a.created_at);

    let kept = 0;
    for (const ev of events) {
      if (kept >= cap) break;
      const coord = npubToCoord.get(ev.pubkey);
      if (!coord) continue; // author not in our accepted list (shouldn't happen with the filter, but cheap)

      const parsed = parseVouchEvent(ev, coord.npub, tier);
      if (!parsed) continue;

      const existing = winners.get(parsed.lnNodeId);
      if (!existing) {
        winners.set(parsed.lnNodeId, parsed);
        kept++;
        const stats = result.byCoordinator[coord.npub];
        stats.tier[tier]++;
        stats.total++;
        continue;
      }
      // Same ln_node_id seen at a stronger tier already — keep stronger.
      const existingRank = TIER_RANK[existing.tier];
      const newRank = TIER_RANK[parsed.tier];
      if (newRank < existingRank) {
        winners.set(parsed.lnNodeId, parsed);
      } else if (newRank === existingRank && parsed.verifiedAt > existing.verifiedAt) {
        winners.set(parsed.lnNodeId, parsed);
      }
      // Either way, this event still represents real coverage from this coordinator.
      const stats = result.byCoordinator[coord.npub];
      stats.tier[tier]++;
      stats.total++;
    }
  }

  let merged: Vouch[] = [...winners.values()].map(rv => ({
    ln_node_id: rv.lnNodeId,
    ln_addresses: rv.lnAddresses,
    tier: rv.tier,
    coordinator: rv.coordinatorNpub,
    host_pubkey: rv.hostPubkey,
    verified_at: rv.verifiedAt,
    expires_at: rv.expiresAt,
    status: 'active' as const,
  }));

  // Final cap — sort by tier then recency, keep top N.
  merged.sort((a, b) => {
    const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (t !== 0) return t;
    return b.verified_at - a.verified_at;
  });
  if (merged.length > opts.maxEntries) merged = merged.slice(0, opts.maxEntries);

  result.vouches = merged;
  return result;
}

/** Tear down the shared pool — useful on logout / app teardown. */
export function closeNostrPool(): void {
  if (sharedPool) {
    try {
      sharedPool.close([]);
    } catch {
      /* nothing to do */
    }
    sharedPool = null;
  }
}
