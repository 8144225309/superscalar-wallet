import { isCompressedPubkey, truncatePubkey } from './validators';

describe('isCompressedPubkey', () => {
  const validHex64 = '0'.repeat(64);

  it('accepts 02-prefixed 33-byte hex', () => {
    expect(isCompressedPubkey('02' + validHex64)).toBe(true);
  });

  it('accepts 03-prefixed 33-byte hex', () => {
    expect(isCompressedPubkey('03' + validHex64)).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(isCompressedPubkey('03' + 'A'.repeat(64))).toBe(true);
  });

  it('rejects uncompressed 04-prefix', () => {
    expect(isCompressedPubkey('04' + validHex64)).toBe(false);
  });

  it('rejects wrong prefix (00, 01)', () => {
    expect(isCompressedPubkey('00' + validHex64)).toBe(false);
    expect(isCompressedPubkey('01' + validHex64)).toBe(false);
  });

  it('rejects wrong length (too short)', () => {
    expect(isCompressedPubkey('02' + '0'.repeat(63))).toBe(false);
  });

  it('rejects wrong length (too long)', () => {
    expect(isCompressedPubkey('02' + '0'.repeat(65))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isCompressedPubkey('02' + 'Z'.repeat(64))).toBe(false);
    expect(isCompressedPubkey('02' + 'g'.repeat(64))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isCompressedPubkey('')).toBe(false);
  });

  it('rejects whitespace around valid pubkey', () => {
    expect(isCompressedPubkey(' 02' + validHex64 + ' ')).toBe(false);
  });
});

describe('truncatePubkey (validators variant — default 6+4)', () => {
  const long = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  it('returns short input unchanged if it fits under head+tail+3', () => {
    expect(truncatePubkey('abcd')).toBe('abcd');
    expect(truncatePubkey('abcdefgh')).toBe('abcdefgh');     // 8 chars, fits under 6+4+3=13
  });

  it('truncates with 6-char head and 4-char tail by default', () => {
    expect(truncatePubkey(long)).toBe('abcdef…6789');
  });

  it('honours custom head and tail', () => {
    expect(truncatePubkey(long, 8, 6)).toBe('abcdef01…456789');
  });

  it('uses Unicode ellipsis (…) not three dots', () => {
    const out = truncatePubkey(long);
    expect(out).toContain('…');
    expect(out).not.toContain('...');
  });

  it('handles empty string', () => {
    expect(truncatePubkey('')).toBe('');
  });
});
