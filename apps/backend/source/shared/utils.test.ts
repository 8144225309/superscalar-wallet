import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import jwt from 'jsonwebtoken';

/* shared/utils.ts reads APP_CONFIG_FILE through APP_CONSTANTS at the
 * point of call (not at module init), so we can mutate the env var
 * AFTER import. But for verifyPassword/isValidPassword we still need
 * the constants module to read the env at re-import time. Use the same
 * vi.resetModules pattern as metrics/audit-log tests for clean state. */
async function freshUtils(envPath: string) {
  process.env.APP_CONFIG_FILE = envPath;
  vi.resetModules();
  return import('./utils.js');
}

describe('parseEnvFile', () => {
  let U: typeof import('./utils.js');
  let tempFile: string;

  beforeEach(async () => {
    tempFile = path.join(os.tmpdir(), `env-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    U = await freshUtils(path.join(os.tmpdir(), `cfg-${Date.now()}.json`));
  });

  afterEach(() => {
    try { fs.unlinkSync(tempFile); } catch { /* nop */ }
  });

  it('parses simple KEY=value lines', () => {
    fs.writeFileSync(tempFile, 'FOO=bar\nBAZ=qux\n', 'utf-8');
    expect(U.parseEnvFile(tempFile)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips surrounding double quotes from values', () => {
    fs.writeFileSync(tempFile, 'GREETING="hello world"\n', 'utf-8');
    expect(U.parseEnvFile(tempFile)).toEqual({ GREETING: 'hello world' });
  });

  it('preserves = inside values', () => {
    fs.writeFileSync(tempFile, 'URL=https://example.com/?a=1&b=2\n', 'utf-8');
    expect(U.parseEnvFile(tempFile)).toEqual({
      URL: 'https://example.com/?a=1&b=2',
    });
  });

  it('skips comment lines starting with #', () => {
    fs.writeFileSync(tempFile, '# this is a comment\nFOO=bar\n', 'utf-8');
    expect(U.parseEnvFile(tempFile)).toEqual({ FOO: 'bar' });
  });

  it('skips blank lines', () => {
    fs.writeFileSync(tempFile, '\n\nFOO=bar\n\n', 'utf-8');
    expect(U.parseEnvFile(tempFile)).toEqual({ FOO: 'bar' });
  });

  it('returns empty object if file does not exist', () => {
    expect(U.parseEnvFile(path.join(os.tmpdir(), 'definitely-not-here.env'))).toEqual({});
  });
});

describe('isAuthenticated', () => {
  let U: typeof import('./utils.js');
  let consts: typeof import('./consts.js');

  beforeEach(async () => {
    /* SECRET_KEY rolls per-process via crypto.randomBytes when
     * APP_JWT_SECRET isn't set. Force a stable value so we can
     * sign and verify in the same test. */
    process.env.APP_JWT_SECRET = '0'.repeat(128);
    U = await freshUtils(path.join(os.tmpdir(), `cfg-${Date.now()}.json`));
    consts = await import('./consts.js');
  });

  it('returns "Token missing" on empty string', () => {
    expect(U.isAuthenticated('')).toBe('Token missing');
  });

  it('returns true for a JWT signed with the same SECRET_KEY', () => {
    const token = jwt.sign({ userID: consts.SECRET_KEY }, consts.SECRET_KEY);
    expect(U.isAuthenticated(token)).toBe(true);
  });

  it('returns an error message for a JWT signed with a different key', () => {
    const token = jwt.sign({ userID: 'bogus' }, 'wrong-key');
    const r = U.isAuthenticated(token);
    expect(r).not.toBe(true);
    expect(typeof r).toBe('string');
  });

  it('returns an error message for garbage input', () => {
    const r = U.isAuthenticated('not.a.jwt');
    expect(r).not.toBe(true);
    expect(typeof r).toBe('string');
  });
});

describe('verifyPassword + isValidPassword', () => {
  let U: typeof import('./utils.js');
  let cfgFile: string;

  beforeEach(async () => {
    cfgFile = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
    U = await freshUtils(cfgFile);
  });

  afterEach(() => {
    try { fs.unlinkSync(cfgFile); } catch { /* nop */ }
  });

  it('verifyPassword returns "Config file does not exist..." when missing', () => {
    expect(U.verifyPassword('anything')).toMatch(/Config file does not exist/);
  });

  it('verifyPassword returns true on exact match', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ password: 'secret' }), 'utf-8');
    expect(U.verifyPassword('secret')).toBe(true);
  });

  it('verifyPassword returns "Incorrect password" on mismatch', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ password: 'secret' }), 'utf-8');
    expect(U.verifyPassword('wrong')).toBe('Incorrect password');
  });

  it('isValidPassword returns true when config has a non-empty password', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ password: 'hashedpw' }), 'utf-8');
    expect(U.isValidPassword()).toBe(true);
  });

  it('isValidPassword returns false when config has empty password', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ password: '' }), 'utf-8');
    expect(U.isValidPassword()).toBe(false);
  });

  it('isValidPassword returns false when password field missing', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({}), 'utf-8');
    expect(U.isValidPassword()).toBe(false);
  });
});
