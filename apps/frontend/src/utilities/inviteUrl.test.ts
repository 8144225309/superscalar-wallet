import { buildInviteUrl, parseInviteUrl, parseInviteUrlDetailed } from './inviteUrl';

const IID = 'a'.repeat(64);   // 32 bytes hex
const LSP = 'b'.repeat(66);   // 33 bytes hex

describe('buildInviteUrl', () => {
  it('emits the minimal required fields', () => {
    const url = buildInviteUrl({ iid: IID, lspNodeId: LSP });
    expect(url).toBe(`superscalar://join?iid=${IID}&lsp=${LSP}`);
  });

  it('includes optional fields when present', () => {
    const url = buildInviteUrl({
      iid: IID,
      lspNodeId: LSP,
      address: '203.0.113.5:9735',
      contributionMinSats: 100_000,
      contributionMaxSats: 1_000_000,
      label: 'My pool',
      expiresAt: 1735689600,
    });
    expect(url).toContain('address=203.0.113.5%3A9735');
    expect(url).toContain('min=100000');
    expect(url).toContain('max=1000000');
    expect(url).toContain('label=My+pool');
    expect(url).toContain('expires=1735689600');
  });

  it('omits zero / null-ish values but keeps explicit 0', () => {
    const url = buildInviteUrl({
      iid: IID,
      lspNodeId: LSP,
      contributionMinSats: 0,
    });
    expect(url).toContain('min=0');
  });
});

describe('parseInviteUrl — happy path', () => {
  it('round-trips through buildInviteUrl', () => {
    const original = {
      iid: IID,
      lspNodeId: LSP,
      address: '203.0.113.5:9735',
      contributionMinSats: 100_000,
      contributionMaxSats: 1_000_000,
      label: 'pool',
    };
    const url = buildInviteUrl(original);
    const parsed = parseInviteUrl(url);
    expect(parsed).toEqual(original);
  });

  it('extracts only iid + lspNodeId when no optionals', () => {
    const url = `superscalar://join?iid=${IID}&lsp=${LSP}`;
    expect(parseInviteUrl(url)).toEqual({
      iid: IID,
      lspNodeId: LSP,
      address: undefined,
      contributionMinSats: undefined,
      contributionMaxSats: undefined,
      label: undefined,
      expiresAt: undefined,
    });
  });

  it('is case-insensitive on the scheme', () => {
    const url = `SUPERSCALAR://join?iid=${IID}&lsp=${LSP}`;
    expect(parseInviteUrl(url)).not.toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    const url = `   superscalar://join?iid=${IID}&lsp=${LSP}\n`;
    expect(parseInviteUrl(url)).not.toBeNull();
  });
});

describe('parseInviteUrl — malformed', () => {
  it.each([
    ['not a url at all'],
    ['http://example.com/join'],
    [`superscalar://join?iid=${IID}`],                          // missing lsp
    [`superscalar://join?lsp=${LSP}`],                          // missing iid
    [`superscalar://join?iid=tooshort&lsp=${LSP}`],             // bad iid format
    [`superscalar://join?iid=${IID}&lsp=tooshort`],             // bad lsp format
    [`superscalar://other?iid=${IID}&lsp=${LSP}`],              // wrong path
  ])('rejects: %s', (url) => {
    expect(parseInviteUrl(url)).toBeNull();
  });

  it('reports malformed via detailed result', () => {
    const res = parseInviteUrlDetailed('superscalar://join?iid=short');
    expect(res.invite).toBeNull();
    expect(res.error).toBe('malformed');
  });
});

describe('parseInviteUrl — expires', () => {
  it('accepts a future expires timestamp', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const url = buildInviteUrl({ iid: IID, lspNodeId: LSP, expiresAt: future });
    const parsed = parseInviteUrl(url);
    expect(parsed?.expiresAt).toBe(future);
  });

  it('rejects an expired invite', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const url = buildInviteUrl({ iid: IID, lspNodeId: LSP, expiresAt: past });
    expect(parseInviteUrl(url)).toBeNull();
  });

  it('reports expired via detailed result', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const url = buildInviteUrl({ iid: IID, lspNodeId: LSP, expiresAt: past });
    const res = parseInviteUrlDetailed(url);
    expect(res.invite).toBeNull();
    expect(res.error).toBe('expired');
  });

  it('ignores non-numeric expires param', () => {
    const url = `superscalar://join?iid=${IID}&lsp=${LSP}&expires=notanumber`;
    const parsed = parseInviteUrl(url);
    /* Non-numeric expires is just dropped — not treated as expired. */
    expect(parsed).not.toBeNull();
    expect(parsed?.expiresAt).toBeUndefined();
  });
});
