import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request } from 'express';

/* AUDIT_LOG_PATH is computed at module-init from APP_AUDIT_LOG_FILE,
 * so each test needs a fresh module bound to a fresh tempdir. The
 * dynamic-import cache-bust pattern is the same as metrics.test.ts. */
/* audit-log.ts reads APP_AUDIT_LOG_FILE at module init, so we set the
 * env var per test and let vi.resetModules clear the cache. */
async function freshModule(envPath: string) {
  process.env.APP_AUDIT_LOG_FILE = envPath;
  const { vi } = await import('vitest');
  vi.resetModules();
  return import('./audit-log.js');
}

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '127.0.0.1',
    headers: {},
    get: (h: string) => (h.toLowerCase() === 'user-agent' ? 'TestAgent/1.0' : ''),
    ...overrides,
  } as unknown as Request;
}

describe('clnMethodToAuditEvent', () => {
  let M: typeof import('./audit-log.js');
  beforeEach(async () => {
    M = await freshModule(path.join(os.tmpdir(), `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`));
  });

  it.each([
    ['factory-create', 'cln_call_factory_create'],
    ['factory-approve-proposal', 'cln_call_factory_approve'],
    ['factory-refuse-proposal', 'cln_call_factory_refuse'],
    ['factory-rotate', 'cln_call_factory_rotate'],
    ['factory-open-channels', 'cln_call_factory_rotate'],
    ['factory-close-proposal', 'cln_call_factory_close'],
    ['factory-force-close', 'cln_call_factory_close'],
    ['fundchannel', 'cln_call_fundchannel'],
    ['close', 'cln_call_close'],
  ])('maps %s → %s', (method, expected) => {
    expect(M.clnMethodToAuditEvent(method)).toBe(expected);
  });

  it.each([
    ['listpeers'],
    ['listfunds'],
    ['getinfo'],
    ['sql'],
    ['unknown-method'],
    [''],
    [null as unknown as string],
  ])('returns null for non-mutating method %s', (method) => {
    expect(M.clnMethodToAuditEvent(method)).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(M.clnMethodToAuditEvent('Factory-Create')).toBe('cln_call_factory_create');
    expect(M.clnMethodToAuditEvent('FUNDCHANNEL')).toBe('cln_call_fundchannel');
  });
});

describe('appendAudit + tailAuditLog', () => {
  let M: typeof import('./audit-log.js');
  let tempFile: string;

  beforeEach(async () => {
    tempFile = path.join(os.tmpdir(), `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`);
    M = await freshModule(tempFile);
  });

  afterEach(() => {
    try { fs.unlinkSync(tempFile); } catch { /* file may not exist */ }
  });

  it('returns empty array when file does not exist', () => {
    expect(M.tailAuditLog(100)).toEqual([]);
  });

  it('appendAudit writes one JSONL line per event', () => {
    M.appendAudit('login_success', fakeReq());
    M.appendAudit('logout', fakeReq());
    const lines = fs.readFileSync(tempFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('login_success');
    expect(JSON.parse(lines[1]).event).toBe('logout');
  });

  it('captures ip and ua from the request', () => {
    M.appendAudit('login_success', fakeReq({ ip: '203.0.113.5' } as unknown as Partial<Request>));
    const entry = JSON.parse(fs.readFileSync(tempFile, 'utf-8').trim());
    expect(entry.ip).toBe('203.0.113.5');
    expect(entry.ua).toBe('TestAgent/1.0');
  });

  it('truncates ua to 200 chars', () => {
    const longUA = 'X'.repeat(500);
    M.appendAudit('login_success', fakeReq({ get: () => longUA } as unknown as Partial<Request>));
    const entry = JSON.parse(fs.readFileSync(tempFile, 'utf-8').trim());
    expect(entry.ua).toHaveLength(200);
  });

  it('falls back to unknown ip when req is undefined', () => {
    M.appendAudit('login_success', undefined);
    const entry = JSON.parse(fs.readFileSync(tempFile, 'utf-8').trim());
    expect(entry.ip).toBe('unknown');
    expect(entry.ua).toBe('');
  });

  it('includes details object when provided', () => {
    M.appendAudit('config_import', fakeReq(), { fromExportedAt: '2026-05-29T12:00:00Z' });
    const entry = JSON.parse(fs.readFileSync(tempFile, 'utf-8').trim());
    expect(entry.details).toEqual({ fromExportedAt: '2026-05-29T12:00:00Z' });
  });

  it('omits details key when not provided', () => {
    M.appendAudit('logout', fakeReq());
    const entry = JSON.parse(fs.readFileSync(tempFile, 'utf-8').trim());
    expect(entry).not.toHaveProperty('details');
  });

  it('tailAuditLog returns the last N entries in file order', () => {
    for (let i = 0; i < 5; i++) {
      M.appendAudit('login_success', fakeReq(), { i });
    }
    const tailed = M.tailAuditLog(3);
    expect(tailed).toHaveLength(3);
    expect((tailed[0].details as { i: number }).i).toBe(2);
    expect((tailed[2].details as { i: number }).i).toBe(4);
  });

  it('tailAuditLog clamps maxLines to a sane range', () => {
    M.appendAudit('login_success', fakeReq());
    expect(M.tailAuditLog(0)).toHaveLength(1);     // clamp up to >=1
    expect(M.tailAuditLog(-5)).toHaveLength(1);    // negative → clamp
    expect(M.tailAuditLog(99999)).toHaveLength(1); // beyond entries
  });

  it('tailAuditLog skips malformed lines (does not crash)', () => {
    M.appendAudit('login_success', fakeReq());
    fs.appendFileSync(tempFile, 'not json\n', 'utf-8');
    M.appendAudit('logout', fakeReq());
    const tailed = M.tailAuditLog(100);
    expect(tailed.map(e => e.event)).toEqual(['login_success', 'logout']);
  });
});
