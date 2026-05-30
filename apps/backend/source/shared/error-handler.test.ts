import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

/* error-handler imports metrics, which uses a singleton registry.
 * Use vi.resetModules per test so the counter starts at zero. */
async function freshHandler() {
  vi.resetModules();
  const handlerMod = await import('./error-handler.js');
  const metricsMod = await import('./metrics.js');
  return { handleError: handlerMod.default, metrics: metricsMod };
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function mockReq(url: string = '/v1/test'): Request {
  return { url } as unknown as Request;
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

describe('handleError', () => {
  let H: Awaited<ReturnType<typeof freshHandler>>;

  beforeEach(async () => {
    H = await freshHandler();
  });

  it('uses error.code for status when present', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { code: 404, message: 'Not found' };
    const res = mockRes();
    H.handleError(err, mockReq(), res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('Not found');
  });

  it('defaults to 500 when error.code is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { message: 'oops' };
    const res = mockRes();
    H.handleError(err, mockReq(), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });

  it('emits the error message as the JSON body', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { code: 400, message: 'Bad input' };
    const res = mockRes();
    H.handleError(err, mockReq(), res as unknown as Response);
    expect(res.body).toBe('Bad input');
  });

  it('stringifies object errors with no message', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { foo: 'bar' };
    const res = mockRes();
    H.handleError(err, mockReq(), res as unknown as Response);
    expect(res.body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('increments soupwallet_http_5xx_total for >=500', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { code: 503, message: 'svc' };
    H.handleError(err, mockReq(), mockRes() as unknown as Response);
    const out = H.metrics.renderMetrics();
    expect(out).toContain('soupwallet_http_5xx_total{status="503"} 1');
  });

  it('does NOT increment 5xx counter for 4xx errors', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { code: 404, message: 'no' };
    H.handleError(err, mockReq(), mockRes() as unknown as Response);
    const out = H.metrics.renderMetrics();
    /* No label sets recorded → registry is empty, zero placeholder
     * emitted only when initMetrics() pre-registers (not called here). */
    expect(out).not.toContain('soupwallet_http_5xx_total{');
  });

  it('5xx counter is labeled with the actual status code', () => {
    H.handleError(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { code: 500, message: 'a' } as any,
      mockReq(), mockRes() as unknown as Response,
    );
    H.handleError(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { code: 502, message: 'b' } as any,
      mockReq(), mockRes() as unknown as Response,
    );
    H.handleError(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { code: 500, message: 'c' } as any,
      mockReq(), mockRes() as unknown as Response,
    );
    const out = H.metrics.renderMetrics();
    expect(out).toContain('soupwallet_http_5xx_total{status="500"} 2');
    expect(out).toContain('soupwallet_http_5xx_total{status="502"} 1');
  });

  it('uses default 500 → counts in 5xx counter', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = { message: 'silent' };  // no code
    H.handleError(err, mockReq(), mockRes() as unknown as Response);
    expect(H.metrics.renderMetrics()).toContain('soupwallet_http_5xx_total{status="500"} 1');
  });
});
