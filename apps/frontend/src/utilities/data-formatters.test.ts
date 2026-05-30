import {
  ConvertSatsToMSats,
  ConvertBTCToSats,
  ConvertSatsToBTC,
  titleCase,
  truncatePubkey,
  isCompatibleVersion,
} from './data-formatters';

describe('unit conversions', () => {
  it('ConvertSatsToMSats multiplies by 1000', () => {
    expect(ConvertSatsToMSats(1)).toBe(1000);
    expect(ConvertSatsToMSats(0)).toBe(0);
    expect(ConvertSatsToMSats(100_000)).toBe(100_000_000);
  });

  it('ConvertBTCToSats multiplies by 1e8', () => {
    expect(ConvertBTCToSats(1)).toBe(100_000_000);
    expect(ConvertBTCToSats(0.001)).toBe(100_000);
  });

  it('ConvertSatsToBTC defaults to 5 decimals', () => {
    expect(ConvertSatsToBTC(100_000_000)).toBe('1.00000');
    expect(ConvertSatsToBTC(50_000)).toBe('0.00050');
  });

  it('ConvertSatsToBTC honours custom precision', () => {
    expect(ConvertSatsToBTC(50_000, 8)).toBe('0.00050000');
    expect(ConvertSatsToBTC(100_000_000, 0)).toBe('1');
  });
});

describe('titleCase', () => {
  it('uppercases the first letter of each word', () => {
    expect(titleCase('hello world')).toBe('Hello World');
    expect(titleCase('factory-detail page')).toBe('Factory-Detail Page');
  });

  it('handles ALL CAPS input', () => {
    expect(titleCase('CHANNELD_NORMAL')).toBe('Channeld_Normal');
  });

  it('returns empty string for falsy input', () => {
    expect(titleCase(undefined)).toBe('');
    expect(titleCase('')).toBe('');
  });

  it('returns empty for non-string input (defensive)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(titleCase(123 as any)).toBe('');
  });
});

describe('truncatePubkey', () => {
  const long = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  it('returns short pubkey untouched if it fits', () => {
    expect(truncatePubkey('abcd')).toBe('abcd');
  });

  it('truncates with 4-char prefix + 4-char suffix by default', () => {
    expect(truncatePubkey(long)).toBe('abcd...6789');
  });

  it('honours custom chars param', () => {
    expect(truncatePubkey(long, 8)).toBe('abcdef01...01234567');
  });

  it('returns empty string when input is empty', () => {
    expect(truncatePubkey('')).toBe('');
  });
});

describe('isCompatibleVersion', () => {
  it('returns true when current >= check', () => {
    expect(isCompatibleVersion('2.5.0', '2.4.0')).toBe(true);
    expect(isCompatibleVersion('2.4.0', '2.4.0')).toBe(true);
    expect(isCompatibleVersion('3.0.0', '2.99.99')).toBe(true);
  });

  it('returns false when current < check', () => {
    expect(isCompatibleVersion('2.4.0', '2.5.0')).toBe(false);
    expect(isCompatibleVersion('1.99.0', '2.0.0')).toBe(false);
  });

  it('strips leading v', () => {
    expect(isCompatibleVersion('v2.5.0', '2.4.0')).toBe(true);
  });

  it('strips -rc suffix', () => {
    expect(isCompatibleVersion('2.5.0-rc1', '2.4.0')).toBe(true);
  });

  it('handles missing patch on either side', () => {
    expect(isCompatibleVersion('2.5', '2.4')).toBe(true);
    expect(isCompatibleVersion('2.4', '2.5')).toBe(false);
  });

  it('returns false on empty / missing inputs', () => {
    expect(isCompatibleVersion('', '2.5.0')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isCompatibleVersion('2.5.0', undefined as any)).toBe(false);
  });
});
