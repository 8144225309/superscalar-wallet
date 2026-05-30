import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* shared/shared.ts read APP_CONFIG_FILE from APP_CONSTANTS at call
 * time, and our test wants to control that path. vi.resetModules
 * then a fresh import gives a clean view per test. */
async function freshController(envPath: string) {
  process.env.APP_CONFIG_FILE = envPath;
  /* Audit-log writes need a tempdir too — otherwise appendAudit fails
   * to write and the request still succeeds, but it pollutes the
   * default ./audit-log.jsonl. */
  process.env.APP_AUDIT_LOG_FILE = path.join(
    os.tmpdir(),
    `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`,
  );
  vi.resetModules();
  const mod = await import('./shared.js');
  return new mod.SharedController({} as unknown as NodeManager);
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  payload: string | null;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  send(payload: string): MockResponse;
  setHeader(name: string, value: string): MockResponse;
}

function mockReq(body: unknown = {}): Request {
  return {
    body,
    ip: '127.0.0.1',
    headers: {},
    get: () => '',
  } as unknown as Request;
}

function mockRes(): MockResponse {
  const r: MockResponse = {
    statusCode: 0,
    headers: {},
    body: null,
    payload: null,
    status(code) { r.statusCode = code; return r; },
    json(payload) { r.body = payload; return r; },
    send(payload) { r.payload = payload; return r; },
    setHeader(name, value) { r.headers[name] = value; return r; },
  };
  return r;
}

const noopNext: NextFunction = () => undefined;

describe('exportConfig', () => {
  let cfgFile: string;
  let controller: { exportConfig: (req: Request, res: Response, next: NextFunction) => Promise<void> };

  beforeEach(async () => {
    cfgFile = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController(cfgFile) as any;
  });
  afterEach(() => { try { fs.unlinkSync(cfgFile); } catch { /* nop */ } });

  it('strips NON_PORTABLE_CONFIG_KEYS from the envelope', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({
      unit: 'SATS',
      appMode: 'DARK',
      password: 'super-secret-hash',
      isLoading: false,
      error: null,
      singleSignOn: false,
      fiatUnit: 'USD',
    }), 'utf-8');
    const res = mockRes();
    await controller.exportConfig(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const envelope = JSON.parse(res.payload as string);
    expect(envelope.kind).toBe('soupwallet-config');
    expect(envelope.version).toBe(1);
    expect(envelope.config).not.toHaveProperty('password');
    expect(envelope.config).not.toHaveProperty('isLoading');
    expect(envelope.config).not.toHaveProperty('error');
    expect(envelope.config).not.toHaveProperty('singleSignOn');
    expect(envelope.config).toEqual({ unit: 'SATS', appMode: 'DARK', fiatUnit: 'USD' });
  });

  it('includes exportedAt + appVersion + Content-Disposition', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ unit: 'BTC' }), 'utf-8');
    const res = mockRes();
    await controller.exportConfig(mockReq(), res as unknown as Response, noopNext);
    const envelope = JSON.parse(res.payload as string);
    expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(envelope.appVersion).toBeDefined();
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Content-Disposition']).toMatch(/^attachment; filename="soupwallet-config-/);
  });
});

describe('importConfig', () => {
  let cfgFile: string;
  let controller: { importConfig: (req: Request, res: Response, next: NextFunction) => Promise<void> };

  beforeEach(async () => {
    cfgFile = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController(cfgFile) as any;
  });
  afterEach(() => { try { fs.unlinkSync(cfgFile); } catch { /* nop */ } });

  it('rejects missing envelope with 400', async () => {
    const res = mockRes();
    await controller.importConfig(mockReq({}), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown kind with 400', async () => {
    const res = mockRes();
    await controller.importConfig(mockReq({
      envelope: { kind: 'other-kind', version: 1, config: {} },
    }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(400);
  });

  it('rejects newer version with 400', async () => {
    const res = mockRes();
    await controller.importConfig(mockReq({
      envelope: { kind: 'soupwallet-config', version: 99, config: {} },
    }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(400);
  });

  it('rejects envelope missing config object', async () => {
    const res = mockRes();
    await controller.importConfig(mockReq({
      envelope: { kind: 'soupwallet-config', version: 1 },
    }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(400);
  });

  it('merges incoming config and PRESERVES existing password hash', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({
      unit: 'SATS',
      appMode: 'LIGHT',
      password: 'existing-hash',
    }), 'utf-8');
    const res = mockRes();
    await controller.importConfig(mockReq({
      envelope: {
        kind: 'soupwallet-config',
        version: 1,
        config: {
          unit: 'BTC',
          appMode: 'DARK',
          /* Attempt to overwrite password — should be ignored. */
          password: 'imported-hash',
        },
      },
    }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(201);
    const persisted = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(persisted.unit).toBe('BTC');
    expect(persisted.appMode).toBe('DARK');
    expect(persisted.password).toBe('existing-hash');
  });

  it('reports the importedKeys (filtered)', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ unit: 'SATS' }), 'utf-8');
    const res = mockRes();
    await controller.importConfig(mockReq({
      envelope: {
        kind: 'soupwallet-config',
        version: 1,
        config: { unit: 'BTC', password: 'sneaky', singleSignOn: true },
      },
    }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(201);
    const body = res.body as { importedKeys: string[] };
    expect(body.importedKeys).toContain('unit');
    expect(body.importedKeys).not.toContain('password');
    expect(body.importedKeys).not.toContain('singleSignOn');
  });
});
