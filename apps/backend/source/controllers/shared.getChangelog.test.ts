import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* getChangelog walks `process.cwd()` + `../..` + `../../..` looking
 * for CHANGELOG.md. The simplest reliable test is to chdir into a
 * tempdir and optionally drop a CHANGELOG.md there. */
async function freshController() {
  vi.resetModules();
  const mod = await import('./shared.js');
  return new mod.SharedController({} as unknown as NodeManager);
}

interface MockResponse {
  statusCode: number;
  body: { sections?: unknown } | null;
  status(code: number): MockResponse;
  json(payload: { sections?: unknown }): MockResponse;
}

function mockReq(): Request {
  return { body: {} } as unknown as Request;
}

function mockRes(): MockResponse {
  const r: MockResponse = {
    statusCode: 0,
    body: null,
    status(code) { r.statusCode = code; return r; },
    json(payload) { r.body = payload; return r; },
  };
  return r;
}

const noopNext: NextFunction = () => undefined;

describe('getChangelog', () => {
  let originalCwd: string;
  let tempDir: string;
  let controller: { getChangelog: (req: Request, res: Response, next: NextFunction) => Promise<void> };

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
    process.chdir(tempDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController() as any;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* nop */ }
  });

  it('returns 200 with empty sections when CHANGELOG.md missing', async () => {
    const res = mockRes();
    await controller.getChangelog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sections: [] });
  });

  it('returns 200 with parsed sections when CHANGELOG.md exists in cwd', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'CHANGELOG.md'),
      [
        '# Changelog',
        '',
        '## [26.05] - 2026-05-29',
        '### Added',
        '- R8.4 vitest infra',
        '- R8.5 audit-log tests',
        '',
        '## [26.04]',
        '### Added',
        '- initial calver tag',
        '',
      ].join('\n'),
      'utf-8',
    );
    const res = mockRes();
    await controller.getChangelog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const sections = (res.body as { sections: Array<{ version: string }> }).sections;
    expect(sections).toHaveLength(2);
    expect(sections[0].version).toBe('26.05');
    expect(sections[1].version).toBe('26.04');
  });

  it('falls back to ../../CHANGELOG.md when present two levels up', async () => {
    /* Simulate the dist runtime layout: cwd is apps/backend/dist,
     * CHANGELOG is at the repo root two levels up. */
    const subdir = path.join(tempDir, 'apps', 'backend');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'CHANGELOG.md'),
      '## [26.05]\n### Added\n- found via two-level fallback\n',
      'utf-8',
    );
    process.chdir(subdir);
    /* re-freshen controller after chdir so any cwd-bound state is fresh */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController() as any;
    const res = mockRes();
    await controller.getChangelog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const sections = (res.body as { sections: Array<{ groups: Array<{ items: string[] }> }> }).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].groups[0].items[0]).toBe('found via two-level fallback');
  });
});
