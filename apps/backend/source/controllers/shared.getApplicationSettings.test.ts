import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* getApplicationSettings reads APP_CONFIG_FILE, strips secret-y keys,
 * and merges in addServerConfig. Pin those three behaviors plus the
 * default-file creation when the path doesn't exist. */

async function freshController(envPath: string) {
  process.env.APP_CONFIG_FILE = envPath;
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
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function mockReq(): Request {
  return { ip: '127.0.0.1', headers: {}, get: () => '' } as unknown as Request;
}

function mockRes(): MockResponse {
  const r: MockResponse = {
    statusCode: 0,
    body: null,
    status(c) { r.statusCode = c; return r; },
    json(p) { r.body = p; return r; },
  };
  return r;
}

const noopNext: NextFunction = () => undefined;

describe('getApplicationSettings', () => {
  let cfgFile: string;
  let controller: { getApplicationSettings: (req: Request, res: Response, next: NextFunction) => Promise<void> };

  beforeEach(async () => {
    cfgFile = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController(cfgFile) as any;
  });

  afterEach(() => {
    try { fs.unlinkSync(cfgFile); } catch { /* nop */ }
  });

  it('creates the config file with defaults when it does not exist', async () => {
    expect(fs.existsSync(cfgFile)).toBe(false);
    const res = mockRes();
    await controller.getApplicationSettings(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(cfgFile)).toBe(true);
    /* Default file is valid JSON */
    const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(typeof raw).toBe('object');
  });

  it('returns 200 with the persisted uiConfig wrapped under `uiConfig`', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ unit: 'SATS', appMode: 'DARK', fiatUnit: 'EUR' }), 'utf-8');
    const res = mockRes();
    await controller.getApplicationSettings(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const body = res.body as { uiConfig: Record<string, unknown> };
    expect(body.uiConfig.unit).toBe('SATS');
    expect(body.uiConfig.appMode).toBe('DARK');
    expect(body.uiConfig.fiatUnit).toBe('EUR');
  });

  it('strips password / isLoading / error / singleSignOn before serializing', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({
      unit: 'BTC',
      password: 'secret-hash',
      isLoading: true,
      error: 'oops',
      singleSignOn: true,
    }), 'utf-8');
    const res = mockRes();
    await controller.getApplicationSettings(mockReq(), res as unknown as Response, noopNext);
    const body = res.body as { uiConfig: Record<string, unknown> };
    expect(body.uiConfig).not.toHaveProperty('password');
    expect(body.uiConfig).not.toHaveProperty('isLoading');
    expect(body.uiConfig).not.toHaveProperty('error');
    expect(body.uiConfig).not.toHaveProperty('singleSignOn');
    expect(body.uiConfig.unit).toBe('BTC');
  });

  it('merges addServerConfig into the response (serverConfig present alongside uiConfig)', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ unit: 'SATS' }), 'utf-8');
    const res = mockRes();
    await controller.getApplicationSettings(mockReq(), res as unknown as Response, noopNext);
    const body = res.body as Record<string, unknown>;
    /* addServerConfig augments the object with at least serverConfig
     * (the env-derived server block). It should not strip uiConfig. */
    expect(body).toHaveProperty('uiConfig');
    expect(body).toHaveProperty('serverConfig');
  });

  it('handles malformed JSON in the config file via the standard error path', async () => {
    fs.writeFileSync(cfgFile, '{ not valid json', 'utf-8');
    const res = mockRes();
    await controller.getApplicationSettings(mockReq(), res as unknown as Response, noopNext);
    /* handleError sends a 500 via res.status(error.code || 500) */
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
