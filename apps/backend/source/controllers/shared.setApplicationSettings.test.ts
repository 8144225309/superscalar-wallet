import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* setApplicationSettings is the write-path counterpart of
 * getApplicationSettings. The load-bearing behavior to pin:
 *   - The existing on-disk password hash is preserved (the frontend
 *     does NOT send it back, and overwriting with undefined would
 *     lock everyone out)
 *   - Other uiConfig fields persist verbatim
 *   - Pretty-printed JSON (2-space indent) so the file is hand-editable
 *   - 201 + success message envelope shape
 *   - Missing config file → standard error handler path */

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

function mockReq(body: unknown): Request {
  return { body, ip: '127.0.0.1', headers: {}, get: () => '' } as unknown as Request;
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

describe('setApplicationSettings', () => {
  let cfgFile: string;
  let controller: {
    setApplicationSettings: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  };

  beforeEach(async () => {
    cfgFile = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
    fs.writeFileSync(cfgFile, JSON.stringify({
      unit: 'SATS',
      appMode: 'LIGHT',
      fiatUnit: 'USD',
      password: 'existing-hash-do-not-touch',
    }), 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController(cfgFile) as any;
  });

  afterEach(() => {
    try { fs.unlinkSync(cfgFile); } catch { /* nop */ }
  });

  it('preserves the existing password hash (frontend never sees it)', async () => {
    const res = mockRes();
    await controller.setApplicationSettings(
      mockReq({ uiConfig: { unit: 'BTC', appMode: 'DARK', fiatUnit: 'EUR' } }),
      res as unknown as Response,
      noopNext,
    );
    expect(res.statusCode).toBe(201);
    const persisted = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(persisted.password).toBe('existing-hash-do-not-touch');
  });

  it('persists the new uiConfig fields verbatim', async () => {
    const res = mockRes();
    await controller.setApplicationSettings(
      mockReq({ uiConfig: { unit: 'BTC', appMode: 'DARK', fiatUnit: 'EUR', showFiatBesideSats: true } }),
      res as unknown as Response,
      noopNext,
    );
    const persisted = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(persisted.unit).toBe('BTC');
    expect(persisted.appMode).toBe('DARK');
    expect(persisted.fiatUnit).toBe('EUR');
    expect(persisted.showFiatBesideSats).toBe(true);
  });

  it('pretty-prints the on-disk JSON (2-space indent — file is hand-editable)', async () => {
    const res = mockRes();
    await controller.setApplicationSettings(
      mockReq({ uiConfig: { unit: 'BTC' } }),
      res as unknown as Response,
      noopNext,
    );
    const raw = fs.readFileSync(cfgFile, 'utf-8');
    expect(raw).toContain('\n  "unit"');  // 2-space indent
    expect(raw).toContain('\n  "password"');
  });

  it('returns 201 with the expected success message envelope', async () => {
    const res = mockRes();
    await controller.setApplicationSettings(
      mockReq({ uiConfig: { unit: 'SATS' } }),
      res as unknown as Response,
      noopNext,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ message: 'Application Settings Updated Successfully' });
  });

  it('5xxs via handleError when the on-disk config file is missing', async () => {
    /* Delete the file before the call; readFileSync will throw ENOENT. */
    fs.unlinkSync(cfgFile);
    const res = mockRes();
    await controller.setApplicationSettings(
      mockReq({ uiConfig: { unit: 'SATS' } }),
      res as unknown as Response,
      noopNext,
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
