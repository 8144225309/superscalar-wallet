import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* getMetrics renders the metrics registry as Prometheus text format
 * and sets the Content-Type header per the Prom convention. */

async function freshController() {
  vi.resetModules();
  const mod = await import('./shared.js');
  return new mod.SharedController({} as unknown as NodeManager);
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  payload: string | null;
  status(code: number): MockResponse;
  send(body: string): MockResponse;
  setHeader(name: string, value: string): MockResponse;
}

function mockReq(): Request {
  return {} as Request;
}

function mockRes(): MockResponse {
  const r: MockResponse = {
    statusCode: 0, headers: {}, payload: null,
    status(c) { r.statusCode = c; return r; },
    send(b) { r.payload = b; return r; },
    setHeader(n, v) { r.headers[n] = v; return r; },
  };
  return r;
}

const noopNext: NextFunction = () => undefined;

describe('getMetrics', () => {
  let controller: { getMetrics: (req: Request, res: Response, next: NextFunction) => Promise<void> };
  let metrics: typeof import('../shared/metrics.js');

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController() as any;
    metrics = await import('../shared/metrics.js');
  });

  it('sets the Prometheus text Content-Type header', async () => {
    const res = mockRes();
    await controller.getMetrics(mockReq(), res as unknown as Response, noopNext);
    expect(res.headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it('returns 200 with trailing newline on an empty registry', async () => {
    const res = mockRes();
    await controller.getMetrics(mockReq(), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe('\n');
  });

  it('renders incremented counters in Prometheus format', async () => {
    metrics.incrementCounter('soupwallet_test_counter', 'Test counter');
    metrics.incrementCounter('soupwallet_test_counter', 'Test counter');
    const res = mockRes();
    await controller.getMetrics(mockReq(), res as unknown as Response, noopNext);
    expect(res.payload).toContain('# HELP soupwallet_test_counter Test counter');
    expect(res.payload).toContain('# TYPE soupwallet_test_counter counter');
    expect(res.payload).toContain('soupwallet_test_counter 2');
  });

  it('renders labels in sorted order with proper escaping', async () => {
    metrics.incrementCounter('soupwallet_test_labeled', 'Labeled', { route: 'login', method: 'POST' });
    const res = mockRes();
    await controller.getMetrics(mockReq(), res as unknown as Response, noopNext);
    /* Keys sorted alphabetically: method, route */
    expect(res.payload).toContain('soupwallet_test_labeled{method="POST",route="login"} 1');
  });

  it('renders multiple metrics in registry order', async () => {
    metrics.incrementCounter('counter_a', 'A');
    metrics.setGauge('gauge_b', 'B', 42);
    const res = mockRes();
    await controller.getMetrics(mockReq(), res as unknown as Response, noopNext);
    expect(res.payload).toContain('# TYPE counter_a counter');
    expect(res.payload).toContain('# TYPE gauge_b gauge');
    expect(res.payload).toContain('counter_a 1');
    expect(res.payload).toContain('gauge_b 42');
  });

  it('initMetrics-populated counters render as zero', async () => {
    metrics.initMetrics();
    const res = mockRes();
    await controller.getMetrics(mockReq(), res as unknown as Response, noopNext);
    expect(res.payload).toContain('soupwallet_auth_login_total 0');
    expect(res.payload).toContain('soupwallet_http_5xx_total 0');
  });
});
