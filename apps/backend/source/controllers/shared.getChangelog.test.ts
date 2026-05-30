import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* getChangelog uses APP_CHANGELOG_PATH (env override) when set, otherwise
 * walks MODULE_DIR + cwd-based fallbacks. Tests pin APP_CHANGELOG_PATH so
 * the controller doesn't accidentally pick up the repo's real
 * CHANGELOG.md (which would make the "missing" case unreproducible). */
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
    /* Pin APP_CHANGELOG_PATH so the controller doesn't find the repo's
     * actual CHANGELOG.md (which would make 'missing' un-reproducible). */
    process.env.APP_CHANGELOG_PATH = path.join(tempDir, 'CHANGELOG.md');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController() as any;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env.APP_CHANGELOG_PATH;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* nop */ }
  });

  it('returns 200 with empty sections when CHANGELOG.md missing at APP_CHANGELOG_PATH', async () => {
    /* Override points at tempDir/CHANGELOG.md which doesn't exist. */
    const res = mockRes();
    await controller.getChangelog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sections: [] });
  });

  it('returns 200 with parsed sections when CHANGELOG.md exists at APP_CHANGELOG_PATH', async () => {
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

  it('APP_CHANGELOG_PATH override wins over module-dir and cwd-based candidates', async () => {
    /* Confirm the env override is THE source of truth — pointing it at
     * an explicit absolute path that exists should win even when cwd
     * is set to a directory that contains its own CHANGELOG.md. */
    const customDir = path.join(tempDir, 'somewhere-else');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(
      path.join(customDir, 'CHANGELOG.md'),
      '## [99.99]\n### Added\n- found via env-var override\n',
      'utf-8',
    );
    process.env.APP_CHANGELOG_PATH = path.join(customDir, 'CHANGELOG.md');
    /* Drop a decoy at cwd so we'd see the wrong result if cwd won. */
    fs.writeFileSync(
      path.join(tempDir, 'CHANGELOG.md'),
      '## [00.00]\n### Added\n- DECOY (cwd should be ignored)\n',
      'utf-8',
    );
    process.chdir(tempDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController() as any;
    const res = mockRes();
    await controller.getChangelog(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const sections = (res.body as { sections: Array<{ version: string; groups: Array<{ items: string[] }> }> }).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].version).toBe('99.99');
    expect(sections[0].groups[0].items[0]).toBe('found via env-var override');
  });
});
