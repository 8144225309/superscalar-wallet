import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* getAuditLog wraps tailAuditLog and returns { entries }. Pin the
 * controller-level contract: default limit (200), explicit limit
 * passthrough, malformed limit fallback to 200, and shape of the
 * response envelope. The underlying tailAuditLog is covered by
 * audit-log.test.ts. */

async function freshController(envPath: string) {
  process.env.APP_AUDIT_LOG_FILE = envPath;
  /* Config file isn't read by getAuditLog but freshController shares
   * the pattern for module reset. */
  process.env.APP_CONFIG_FILE = path.join(os.tmpdir(), `cfg-${Date.now()}.json`);
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

function mockReq(limitParam?: string): Request {
  const query = limitParam !== undefined ? { limit: limitParam } : undefined;
  return { query, ip: '127.0.0.1', headers: {}, get: () => '' } as unknown as Request;
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

describe('getAuditLog', () => {
  let logFile: string;
  let controller: {
    getAuditLog: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  };

  beforeEach(async () => {
    logFile = path.join(os.tmpdir(), `aud-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jsonl`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController(logFile) as any;
  });

  afterEach(() => {
    try { fs.unlinkSync(logFile); } catch { /* nop */ }
  });

  it('returns 200 with empty entries array when no log file exists', async () => {
    const res = mockRes();
    await controller.getAuditLog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ entries: [] });
  });

  it('returns entries from the log file under entries key', async () => {
    fs.writeFileSync(
      logFile,
      JSON.stringify({ ts: '2026-05-29T00:00:00Z', ip: '127.0.0.1', ua: 'test', event: 'login_success' }) + '\n' +
      JSON.stringify({ ts: '2026-05-29T00:01:00Z', ip: '127.0.0.1', ua: 'test', event: 'logout' }) + '\n',
      'utf-8',
    );
    const res = mockRes();
    await controller.getAuditLog(mockReq(), res as unknown as Response, noopNext);
    const body = res.body as { entries: { event: string }[] };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].event).toBe('login_success');
    expect(body.entries[1].event).toBe('logout');
  });

  it('honours the limit query parameter', async () => {
    let lines = '';
    for (let i = 0; i < 10; i++) {
      lines += JSON.stringify({ ts: `2026-05-29T00:0${i}:00Z`, ip: '127.0.0.1', ua: 'test', event: 'login_success', details: { i } }) + '\n';
    }
    fs.writeFileSync(logFile, lines, 'utf-8');
    const res = mockRes();
    await controller.getAuditLog(mockReq('3'), res as unknown as Response, noopNext);
    const body = res.body as { entries: { details: { i: number } }[] };
    /* tail returns the LAST 3 entries (i=7,8,9). */
    expect(body.entries).toHaveLength(3);
    expect(body.entries.map((e) => e.details.i)).toEqual([7, 8, 9]);
  });

  it('falls back to default (200) when limit is non-numeric garbage', async () => {
    let lines = '';
    for (let i = 0; i < 5; i++) {
      lines += JSON.stringify({ ts: '2026-05-29T00:00:00Z', ip: '127.0.0.1', ua: 'test', event: 'login_success', details: { i } }) + '\n';
    }
    fs.writeFileSync(logFile, lines, 'utf-8');
    const res = mockRes();
    await controller.getAuditLog(mockReq('not-a-number'), res as unknown as Response, noopNext);
    const body = res.body as { entries: unknown[] };
    /* Default fallback is 200 (well over the 5 entries) — should return all. */
    expect(body.entries).toHaveLength(5);
  });

  it('skips malformed JSONL lines without 5xx-ing', async () => {
    fs.writeFileSync(
      logFile,
      JSON.stringify({ ts: '2026-05-29T00:00:00Z', ip: '127.0.0.1', ua: 'test', event: 'login_success' }) + '\n' +
      'not-json\n' +
      JSON.stringify({ ts: '2026-05-29T00:01:00Z', ip: '127.0.0.1', ua: 'test', event: 'logout' }) + '\n',
      'utf-8',
    );
    const res = mockRes();
    await controller.getAuditLog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const body = res.body as { entries: { event: string }[] };
    /* Two valid + one skipped = 2. */
    expect(body.entries).toHaveLength(2);
  });
});
