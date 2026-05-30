import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

/* express-rate-limit returns middleware whose internals are not safe
 * to call directly in unit tests. Mock the factory to capture the
 * `options` config object passed to it — then we can invoke the
 * `handler` and `message` properties directly and observe the
 * resulting status, body, and metrics-counter side effects. */

type CapturedOptions = {
  windowMs: number;
  limit: number;
  message: { error: string };
  skipSuccessfulRequests?: boolean;
  handler: (req: Request, res: Response, next: () => void, options: { statusCode: number; message: { error: string } }) => void;
};

const captured: CapturedOptions[] = [];

vi.mock('express-rate-limit', () => ({
  default: (opts: CapturedOptions) => {
    captured.push(opts);
    /* Return something middleware-shaped; nothing in this test calls it. */
    return () => undefined;
  },
}));

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function mockReq(): Request {
  return {
    ip: '203.0.113.5',
    get: (h: string) => (h.toLowerCase() === 'user-agent' ? 'TestUA/1.0' : ''),
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

describe('rate-limit middleware config', () => {
  beforeEach(async () => {
    captured.length = 0;
    vi.resetModules();
    await import('./auth-rate-limit.js');
  });

  it('configures loginRateLimiter with 15min window + 5 attempts', () => {
    const login = captured[0];
    expect(login.windowMs).toBe(15 * 60 * 1000);
    expect(login.limit).toBe(5);
    expect(login.skipSuccessfulRequests).toBe(true);
    expect(login.message.error).toMatch(/Too many login attempts/);
  });

  it('configures passwordResetRateLimiter with 1h window + 3 attempts', () => {
    const reset = captured[1];
    expect(reset.windowMs).toBe(60 * 60 * 1000);
    expect(reset.limit).toBe(3);
    expect(reset.message.error).toMatch(/Too many password reset attempts/);
  });
});

describe('rate-limit handler behavior', () => {
  let loginHandler: CapturedOptions['handler'];
  let resetHandler: CapturedOptions['handler'];
  let metrics: typeof import('./metrics.js');

  beforeEach(async () => {
    captured.length = 0;
    vi.resetModules();
    await import('./auth-rate-limit.js');
    loginHandler = captured[0].handler;
    resetHandler = captured[1].handler;
    metrics = await import('./metrics.js');
  });

  it('login handler returns the configured statusCode + message body', () => {
    const res = mockRes();
    loginHandler(
      mockReq(),
      res as unknown as Response,
      () => undefined,
      { statusCode: 429, message: { error: 'Too many login attempts from this IP. Try again in 15 minutes.' } },
    );
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many login attempts from this IP. Try again in 15 minutes.' });
  });

  it('login handler increments rate-limit-hits counter with route=login', () => {
    loginHandler(
      mockReq(),
      mockRes() as unknown as Response,
      () => undefined,
      { statusCode: 429, message: { error: 'x' } },
    );
    const out = metrics.renderMetrics();
    expect(out).toContain('soupwallet_auth_rate_limit_hits_total{route="login"} 1');
  });

  it('reset handler increments counter with route=reset', () => {
    resetHandler(
      mockReq(),
      mockRes() as unknown as Response,
      () => undefined,
      { statusCode: 429, message: { error: 'x' } },
    );
    const out = metrics.renderMetrics();
    expect(out).toContain('soupwallet_auth_rate_limit_hits_total{route="reset"} 1');
  });

  it('counters for login + reset are tracked separately', () => {
    loginHandler(mockReq(), mockRes() as unknown as Response, () => undefined,
      { statusCode: 429, message: { error: 'x' } });
    loginHandler(mockReq(), mockRes() as unknown as Response, () => undefined,
      { statusCode: 429, message: { error: 'x' } });
    resetHandler(mockReq(), mockRes() as unknown as Response, () => undefined,
      { statusCode: 429, message: { error: 'x' } });
    const out = metrics.renderMetrics();
    expect(out).toContain('soupwallet_auth_rate_limit_hits_total{route="login"} 2');
    expect(out).toContain('soupwallet_auth_rate_limit_hits_total{route="reset"} 1');
  });
});
