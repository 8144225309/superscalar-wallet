import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { NodeProfile } from '../models/node-profile.type.js';

/* NodesController tests focus on the sanitization contract: rune
 * NEVER leaves the server, and the wire envelope matches what the
 * frontend nodes slice expects. Uses a fake NodeManager that just
 * holds in-memory state — no real CLN transport is exercised. */

class FakeNodeManager {
  private _profiles: NodeProfile[] = [];
  private _active: NodeProfile | null = null;
  private _connected = false;

  setProfiles(p: NodeProfile[]) { this._profiles = p; }
  setActive(p: NodeProfile | null) { this._active = p; }
  setConnected(b: boolean) { this._connected = b; }

  listProfiles() { return this._profiles; }
  getActiveProfile() { return this._active; }
  isConnected() { return this._connected; }

  async switchNode(id: string) {
    const p = this._profiles.find(p => p.id === id);
    if (!p) throw new Error('not found');
    this._active = p;
    return p;
  }
  async addProfile(p: any) {
    const full: NodeProfile = { id: 'new-id', ...p };
    this._profiles.push(full);
    return full;
  }
  async removeProfile(id: string) {
    this._profiles = this._profiles.filter(p => p.id !== id);
  }
  async discoverNodes() {
    return this._profiles.slice(0);
  }
  async checkAllHealth() {
    return this._profiles.map(p => ({ id: p.id, reachable: true, latency_ms: 12 }));
  }
}

async function freshController(mgr: FakeNodeManager) {
  vi.resetModules();
  const mod = await import('./nodes.js');
  return new mod.NodesController(mgr as any);
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  send(): MockResponse;
}

function mockReq(opts: { body?: any; params?: any } = {}): Request {
  return { body: opts.body, params: opts.params, ip: '127.0.0.1', headers: {}, get: () => '' } as unknown as Request;
}

function mockRes(): MockResponse {
  const r: MockResponse = {
    statusCode: 0, body: null,
    status(c) { r.statusCode = c; return r; },
    json(p) { r.body = p; return r; },
    send() { return r; },
  };
  return r;
}

const noopNext: NextFunction = () => undefined;

const PROFILE_A: NodeProfile = {
  id: 'a', label: 'Node A', pubkey: '02aa', rune: 'RUNE-A-SECRET',
  wsHost: '1.2.3.4', wsPort: 9735,
} as NodeProfile;
const PROFILE_B: NodeProfile = {
  id: 'b', label: 'Node B', pubkey: '02bb', rune: 'RUNE-B-SECRET',
  wsHost: '5.6.7.8', wsPort: 9735,
} as NodeProfile;

describe('NodesController.listProfiles', () => {
  let mgr: FakeNodeManager;
  let controller: any;

  beforeEach(async () => {
    mgr = new FakeNodeManager();
    controller = await freshController(mgr);
  });

  it('returns the activeProfileId + sanitized profiles + isConnected envelope', async () => {
    mgr.setProfiles([PROFILE_A, PROFILE_B]);
    mgr.setActive(PROFILE_A);
    mgr.setConnected(true);
    const res = mockRes();
    await controller.listProfiles(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const body = res.body as { activeProfileId: string; profiles: any[]; isConnected: boolean };
    expect(body.activeProfileId).toBe('a');
    expect(body.isConnected).toBe(true);
    expect(body.profiles).toHaveLength(2);
    /* Rune must be stripped on EVERY profile. */
    for (const p of body.profiles) {
      expect(p).not.toHaveProperty('rune');
      /* Other fields preserved. */
      expect(p.pubkey).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
  });

  it('returns activeProfileId=null when no profile is active', async () => {
    mgr.setProfiles([]);
    mgr.setActive(null);
    const res = mockRes();
    await controller.listProfiles(mockReq(), res as unknown as Response, noopNext);
    const body = res.body as { activeProfileId: string | null };
    expect(body.activeProfileId).toBeNull();
  });
});

describe('NodesController.getActiveProfile', () => {
  let mgr: FakeNodeManager;
  let controller: any;

  beforeEach(async () => {
    mgr = new FakeNodeManager();
    controller = await freshController(mgr);
  });

  it('returns the active profile (rune stripped)', async () => {
    mgr.setActive(PROFILE_A);
    const res = mockRes();
    await controller.getActiveProfile(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const body = res.body as { profile: any };
    expect(body.profile.id).toBe('a');
    expect(body.profile).not.toHaveProperty('rune');
  });

  it('returns {profile: null} when no active profile', async () => {
    mgr.setActive(null);
    const res = mockRes();
    await controller.getActiveProfile(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ profile: null });
  });
});

describe('NodesController.switchNode', () => {
  let mgr: FakeNodeManager;
  let controller: any;

  beforeEach(async () => {
    mgr = new FakeNodeManager();
    mgr.setProfiles([PROFILE_A, PROFILE_B]);
    mgr.setActive(PROFILE_A);
    controller = await freshController(mgr);
  });

  it('returns 400 when profileId is missing', async () => {
    const res = mockRes();
    await controller.switchNode(mockReq({ body: {} }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(400);
  });

  it('switches to the named profile and returns it sanitized', async () => {
    const res = mockRes();
    await controller.switchNode(mockReq({ body: { profileId: 'b' } }), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const body = res.body as { profile: any };
    expect(body.profile.id).toBe('b');
    expect(body.profile).not.toHaveProperty('rune');
    expect(mgr.getActiveProfile()?.id).toBe('b');
  });
});

describe('NodesController.discoverNodes', () => {
  let mgr: FakeNodeManager;
  let controller: any;

  beforeEach(async () => {
    mgr = new FakeNodeManager();
    mgr.setProfiles([PROFILE_A, PROFILE_B]);
    controller = await freshController(mgr);
  });

  it('returns sanitized discovered profiles', async () => {
    const res = mockRes();
    await controller.discoverNodes(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    const body = res.body as { profiles: any[] };
    expect(body.profiles).toHaveLength(2);
    for (const p of body.profiles) {
      expect(p).not.toHaveProperty('rune');
    }
  });
});
