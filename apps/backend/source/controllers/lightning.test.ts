import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* lightning controller's audit branch fires on mutating CLN methods.
 * We construct it with a mock NodeManager whose getActiveService
 * returns a stub clnService that resolves call() instantly. The
 * audit-log writes to $APP_AUDIT_LOG_FILE which we point at a
 * tempfile. */

async function freshController(auditFile: string) {
  process.env.APP_AUDIT_LOG_FILE = auditFile;
  vi.resetModules();
  const mod = await import('./lightning.js');
  const nm = {
    getActiveService: () => ({
      call: vi.fn().mockResolvedValue({ ok: true }),
      getLNMsgPubkey: () => '',
    }),
  } as unknown as NodeManager;
  return new mod.LightningController(nm);
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function mockReq(method: string): Request {
  return {
    body: { method, params: {} },
    ip: '127.0.0.1',
    headers: {},
    get: () => '',
  } as unknown as Request;
}

function mockRes(): MockResponse {
  const r: MockResponse = {
    statusCode: 0, body: null,
    status(c) { r.statusCode = c; return r; },
    json(p) { r.body = p; return r; },
  };
  return r;
}

const noopNext: NextFunction = () => undefined;

function readAudit(file: string): Array<{ event: string; details?: { method?: string } }> {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map(l => JSON.parse(l));
}

describe('callMethod audit-branch integration', () => {
  let auditFile: string;
  let controller: { callMethod: (req: Request, res: Response, next: NextFunction) => Promise<void> };

  beforeEach(async () => {
    auditFile = path.join(os.tmpdir(), `lt-aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController(auditFile) as any;
  });
  afterEach(() => { try { fs.unlinkSync(auditFile); } catch { /* nop */ } });

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
  ])('mutating method %s → audit event %s with method in details', async (method, expectedEvent) => {
    await controller.callMethod(mockReq(method), mockRes() as unknown as Response, noopNext);
    /* Audit append is synchronous (appendFileSync); no need to wait. */
    const entries = readAudit(auditFile);
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe(expectedEvent);
    expect(entries[0].details?.method).toBe(method);
  });

  it.each([
    ['listpeers'],
    ['listfunds'],
    ['getinfo'],
    ['sql'],
    ['unknown-method'],
  ])('read-only method %s does NOT audit', async (method) => {
    await controller.callMethod(mockReq(method), mockRes() as unknown as Response, noopNext);
    expect(readAudit(auditFile)).toHaveLength(0);
  });

  it('audit fires BEFORE the clnService call resolves (so a failing RPC still leaves trail)', async () => {
    /* Re-construct with a clnService that throws so we hit the .catch
     * branch. The audit should still be written, since it runs before
     * the RPC. */
    process.env.APP_AUDIT_LOG_FILE = auditFile;
    vi.resetModules();
    const mod = await import('./lightning.js');
    const nm = {
      getActiveService: () => ({
        call: vi.fn().mockRejectedValue(new Error('RPC failed')),
        getLNMsgPubkey: () => '',
      }),
    } as unknown as NodeManager;
    const c = new mod.LightningController(nm);
    /* Run the controller call and let the catch path resolve naturally.
     * handleError will write a 500 to res, which we ignore. */
    await c.callMethod(mockReq('factory-create'), mockRes() as unknown as Response, noopNext);
    /* The promise chain is async; let the microtask queue drain. */
    await new Promise(r => setImmediate(r));
    const entries = readAudit(auditFile);
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('cln_call_factory_create');
  });
});
