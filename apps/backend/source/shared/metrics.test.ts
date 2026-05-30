import { describe, it, expect, beforeEach } from 'vitest';

/* metrics.ts uses a module-level singleton registry. Each test needs
 * a fresh registry; we get that by re-importing the module via
 * vi.resetModules-equivalent — vitest's import.meta.glob doesn't help
 * here, but a dynamic import with a query-string suffix forces a
 * fresh module instance. */
async function freshMetrics() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__metricsCacheBust = ((globalThis as any).__metricsCacheBust || 0) + 1;
  return import(`./metrics.js?bust=${(globalThis as any).__metricsCacheBust}`);
}

describe('metrics', () => {
  let M: typeof import('./metrics.js');
  beforeEach(async () => {
    M = await freshMetrics();
  });

  it('renderMetrics on an empty registry returns trailing newline only', () => {
    expect(M.renderMetrics()).toBe('\n');
  });

  it('incrementCounter creates the counter and renders with default value 1', () => {
    M.incrementCounter('test_counter', 'a test counter');
    const out = M.renderMetrics();
    expect(out).toContain('# HELP test_counter a test counter');
    expect(out).toContain('# TYPE test_counter counter');
    expect(out).toContain('test_counter 1');
  });

  it('incrementCounter accumulates by 1 each call', () => {
    M.incrementCounter('test_counter', 'help');
    M.incrementCounter('test_counter', 'help');
    M.incrementCounter('test_counter', 'help');
    expect(M.renderMetrics()).toContain('test_counter 3');
  });

  it('incrementCounter supports a custom `by` increment', () => {
    M.incrementCounter('test_counter', 'help', {}, 5);
    M.incrementCounter('test_counter', 'help', {}, 2);
    expect(M.renderMetrics()).toContain('test_counter 7');
  });

  it('different label sets are tracked as separate samples', () => {
    M.incrementCounter('test_counter', 'help', { route: 'login' });
    M.incrementCounter('test_counter', 'help', { route: 'login' });
    M.incrementCounter('test_counter', 'help', { route: 'reset' });
    const out = M.renderMetrics();
    expect(out).toContain('test_counter{route="login"} 2');
    expect(out).toContain('test_counter{route="reset"} 1');
  });

  it('label keys are sorted in the rendered output', () => {
    M.incrementCounter('test_counter', 'help', { z: '1', a: '2', m: '3' });
    const out = M.renderMetrics();
    expect(out).toContain('test_counter{a="2",m="3",z="1"} 1');
  });

  it('label values are escaped (backslash + double quote + newline)', () => {
    M.incrementCounter('test_counter', 'help', { ua: 'has"a\\quote\nnl' });
    const out = M.renderMetrics();
    expect(out).toContain(`ua="has\\"a\\\\quote\\nnl"`);
  });

  it('setGauge writes (does not accumulate) the value', () => {
    M.setGauge('test_gauge', 'help', 100);
    M.setGauge('test_gauge', 'help', 42);
    const out = M.renderMetrics();
    expect(out).toContain('# TYPE test_gauge gauge');
    expect(out).toContain('test_gauge 42');
    expect(out).not.toContain('test_gauge 100');
  });

  it('re-registering with conflicting type throws', () => {
    M.incrementCounter('conflict', 'help');
    expect(() => M.setGauge('conflict', 'help', 1)).toThrow(
      /already registered with type counter, can't re-register as gauge/,
    );
  });

  it('initMetrics pre-registers all wallet counters as zero', () => {
    M.initMetrics();
    const out = M.renderMetrics();
    expect(out).toContain('soupwallet_auth_login_total 0');
    expect(out).toContain('soupwallet_auth_login_success_total 0');
    expect(out).toContain('soupwallet_auth_login_failure_total 0');
    expect(out).toContain('soupwallet_auth_rate_limit_hits_total 0');
    expect(out).toContain('soupwallet_http_5xx_total 0');
    expect(out).toMatch(/soupwallet_process_start_time_seconds \d+/);
  });
});
