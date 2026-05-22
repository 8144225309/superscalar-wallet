/* Session 6a (Tier-2 polish): superscalar:// invite URL helpers.
 *
 * Format: superscalar://join?iid=<hex>&lsp=<node_id>&address=<host:port>
 *                          [&min=<sats>] [&max=<sats>] [&label=<text>]
 *
 * LSP generates these (factory iid + own node id + ip:port from listconfigs).
 * Client parses and pre-fills the join modal.
 *
 * Keep the URL human-readable — these will be pasted around in chats and
 * the wallet UI shows the parsed fields before submitting the actual
 * factory-join-request. */

export type Invite = {
  iid: string;
  lspNodeId: string;
  address?: string;
  contributionMinSats?: number;
  contributionMaxSats?: number;
  label?: string;
};

export function buildInviteUrl(invite: Invite): string {
  const params = new URLSearchParams();
  params.set('iid', invite.iid);
  params.set('lsp', invite.lspNodeId);
  if (invite.address) params.set('address', invite.address);
  if (invite.contributionMinSats != null) params.set('min', String(invite.contributionMinSats));
  if (invite.contributionMaxSats != null) params.set('max', String(invite.contributionMaxSats));
  if (invite.label) params.set('label', invite.label);
  return `superscalar://join?${params.toString()}`;
}

export function parseInviteUrl(url: string): Invite | null {
  let parsed: URL;
  try {
    // URL constructor doesn't accept custom schemes well in all browsers; normalize.
    const normalized = url.trim().replace(/^superscalar:\/\//i, 'https://_invite_/');
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  if (!parsed.pathname.endsWith('/join') && !parsed.pathname.includes('join')) return null;
  const q = parsed.searchParams;
  const iid = q.get('iid');
  const lsp = q.get('lsp');
  if (!iid || !lsp) return null;
  // Light validation: pubkey is 33 bytes hex (66 chars); iid is 32 bytes hex (64 chars).
  if (!/^[0-9a-fA-F]{64}$/.test(iid)) return null;
  if (!/^[0-9a-fA-F]{66}$/.test(lsp)) return null;

  const min = q.get('min');
  const max = q.get('max');
  return {
    iid,
    lspNodeId: lsp,
    address: q.get('address') ?? undefined,
    contributionMinSats: min ? Number(min) : undefined,
    contributionMaxSats: max ? Number(max) : undefined,
    label: q.get('label') ?? undefined,
  };
}
