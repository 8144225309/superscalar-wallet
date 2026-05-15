const COMPRESSED_PUBKEY_RE = /^0[23][0-9a-fA-F]{64}$/;

export const isCompressedPubkey = (s: string): boolean => COMPRESSED_PUBKEY_RE.test(s);

export const truncatePubkey = (s: string, head: number = 6, tail: number = 4): string =>
  s.length > head + tail + 3 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
