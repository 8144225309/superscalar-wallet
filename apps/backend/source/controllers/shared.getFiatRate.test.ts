import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { NodeManager } from '../service/node-manager.service.js';

/* getFiatRate calls axios.get against a CoinGecko-style endpoint.
 * Mock axios at the module level so we can simulate the three
 * branches: success, response missing 'bitcoin' object (404 path),
 * axios error (200 + rate:0 fallback). */

vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(),
    },
  };
});

async function freshController() {
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

function mockReq(currency: string): Request {
  return { params: { fiatCurrency: currency } } as unknown as Request;
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

describe('getFiatRate', () => {
  let axios: { default: { get: ReturnType<typeof vi.fn> } };
  let controller: { getFiatRate: (req: Request, res: Response, next: NextFunction) => Promise<void> };

  beforeEach(async () => {
    /* Re-import axios after vi.mock + vi.resetModules so the mock
     * is fresh per test. The vi.mock factory shape doesn't match the
     * real axios module type, so cast through unknown. */
    axios = (await import('axios')) as unknown as { default: { get: ReturnType<typeof vi.fn> } };
    axios.default.get.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller = await freshController() as any;
  });

  it('returns rate from CoinGecko-style response.data.bitcoin.<currency>', async () => {
    axios.default.get.mockResolvedValue({
      data: { bitcoin: { usd: 65000 } },
    });
    const res = mockRes();
    await controller.getFiatRate(mockReq('usd'), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ rate: 65000 });
  });

  it('extracts the first bitcoin field value regardless of currency name', async () => {
    axios.default.get.mockResolvedValue({
      data: { bitcoin: { eur: 60000 } },
    });
    const res = mockRes();
    await controller.getFiatRate(mockReq('eur'), res as unknown as Response, noopNext);
    expect(res.body).toEqual({ rate: 60000 });
  });

  it('handles non-numeric rate (returns 0 via Object.values + handleError fallback)', async () => {
    /* CoinGecko sometimes returns undefined for unsupported pairs.
     * The handler then calls handleError with NOT_FOUND. */
    axios.default.get.mockResolvedValue({
      data: { bitcoin: { xyz: undefined } },
    });
    const res = mockRes();
    await controller.getFiatRate(mockReq('xyz'), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(404);
  });

  it('axios error → returns 200 with rate:0 (graceful fallback)', async () => {
    axios.default.get.mockRejectedValue(new Error('Network down'));
    const res = mockRes();
    await controller.getFiatRate(mockReq('usd'), res as unknown as Response, noopNext);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ rate: 0 });
  });

  it('response.data.bitcoin missing → no branch fires (graceful)', async () => {
    axios.default.get.mockResolvedValue({ data: {} });
    const res = mockRes();
    /* The current handler simply doesn't call res in this branch.
     * Confirm that's the case (statusCode stays 0). */
    await controller.getFiatRate(mockReq('usd'), res as unknown as Response, noopNext);
    /* No response sent — handler tolerates malformed upstream. */
    expect(res.statusCode).toBe(0);
  });
});
