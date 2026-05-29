/* Session 6a (Tier-2 polish): superscalar:// invite URL helpers.
 *
 * Format: superscalar://join?iid=<hex>&lsp=<node_id>&address=<host:port>
 *                          [&min=<sats>] [&max=<sats>] [&label=<text>]
 *                          [&expires=<unix-ts>]
 *
 * LSP generates these (factory iid + own node id + ip:port from listconfigs).
 * Client parses and pre-fills the join modal.
 *
 * Keep the URL human-readable — these will be pasted around in chats and
 * the wallet UI shows the parsed fields before submitting the actual
 * factory-join-request.
 *
 * Expiry policy (added 2026-05-29): `expires` is an optional unix timestamp.
 * The wallet refuses parsed invites whose expires < now. This is a UX gate,
 * NOT a security one — anyone with the URL can still hand-craft a
 * factory-join-request from CLI. The LSP-side auto-accept policy is what
 * actually gates the join. Treat expires like a "use-by" hint that lets the
 * host stop accidentally getting joined six months after the invite went
 * around. */

export type Invite = {
  iid: string;
  lspNodeId: string;
  address?: string;
  contributionMinSats?: number;
  contributionMaxSats?: number;
  label?: string;
  /** Unix timestamp seconds. If set and in the past, parseInviteUrl returns null. */
  expiresAt?: number;
};

export function buildInviteUrl(invite: Invite): string {
  const params = new URLSearchParams();
  params.set('iid', invite.iid);
  params.set('lsp', invite.lspNodeId);
  if (invite.address) params.set('address', invite.address);
  if (invite.contributionMinSats != null) params.set('min', String(invite.contributionMinSats));
  if (invite.contributionMaxSats != null) params.set('max', String(invite.contributionMaxSats));
  if (invite.label) params.set('label', invite.label);
  if (invite.expiresAt != null) params.set('expires', String(invite.expiresAt));
  return `superscalar://join?${params.toString()}`;
}

export type ParseError = 'malformed' | 'expired' | null;

export type ParseResult = {
  invite: Invite | null;
  error: ParseError;
};

/**
 * Parse + validate. Returns the structured invite or null on bad input.
 * Use parseInviteUrlDetailed when the caller wants to distinguish
 * "malformed" from "expired" for better UX messaging.
 */
export function parseInviteUrl(url: string): Invite | null {
  return parseInviteUrlDetailed(url).invite;
}

export function parseInviteUrlDetailed(url: string): ParseResult {
  let parsed: URL;
  try {
    // URL constructor doesn't accept custom schemes well in all browsers; normalize.
    const normalized = url.trim().replace(/^superscalar:\/\//i, 'https://_invite_/');
    parsed = new URL(normalized);
  } catch {
    return { invite: null, error: 'malformed' };
  }
  if (!parsed.pathname.endsWith('/join') && !parsed.pathname.includes('join')) {
    return { invite: null, error: 'malformed' };
  }
  const q = parsed.searchParams;
  const iid = q.get('iid');
  const lsp = q.get('lsp');
  if (!iid || !lsp) return { invite: null, error: 'malformed' };
  // Light validation: pubkey is 33 bytes hex (66 chars); iid is 32 bytes hex (64 chars).
  if (!/^[0-9a-fA-F]{64}$/.test(iid)) return { invite: null, error: 'malformed' };
  if (!/^[0-9a-fA-F]{66}$/.test(lsp)) return { invite: null, error: 'malformed' };

  const min = q.get('min');
  const max = q.get('max');
  const expiresStr = q.get('expires');
  let expiresAt: number | undefined;
  if (expiresStr) {
    const n = Number(expiresStr);
    if (Number.isFinite(n)) {
      expiresAt = n;
      if (n * 1000 < Date.now()) {
        return { invite: null, error: 'expired' };
      }
    }
  }

  return {
    invite: {
      iid,
      lspNodeId: lsp,
      address: q.get('address') ?? undefined,
      contributionMinSats: min ? Number(min) : undefined,
      contributionMaxSats: max ? Number(max) : undefined,
      label: q.get('label') ?? undefined,
      expiresAt,
    },
    error: null,
  };
}
