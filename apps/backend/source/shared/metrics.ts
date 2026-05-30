/**
 * Metrics — tiny in-process Prometheus-text emitter.
 *
 * What it does
 *   Holds a process-local Map of counters and gauges and renders them
 *   in Prometheus text format. Scraped via GET /v1/shared/metrics.
 *
 * Why no client lib
 *   The wire format is trivial (~30 lines of code) and avoids pulling
 *   prom-client just for ~5 counters. No buckets/histograms here yet.
 *
 *     # HELP <name> <help text>
 *     # TYPE <name> <counter|gauge>
 *     <name>{label="value",...} <number>
 *
 * Scope boundary
 *   WALLET-side only — login attempts, http errors, audit-write
 *   failures. CLN node, plugin, and protocol-level metrics belong to
 *   the plugin team's `factory-metrics` RPC and the lib's prometheus
 *   adapter, NOT here.
 *
 * Lifecycle
 *   Counters reset to zero on process restart. For long-horizon
 *   dashboards, scrape into a real TSDB (Prometheus, Mimir, etc.).
 *
 * Public API
 *   - `initMetrics()`: pre-register the standard set so they appear
 *     at zero before any traffic
 *   - `incrementCounter(name, labels?)` / `setGauge(name, value, labels?)`
 *   - `renderMetrics(): string` — Prometheus text body
 *   - `clearRegistryForTesting()` — reset between vitest cases
 */

type Labels = Record<string, string>;

interface Metric {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  values: Map<string, { labels: Labels; value: number }>;
}

const registry = new Map<string, Metric>();

function register(name: string, help: string, type: 'counter' | 'gauge'): Metric {
  const existing = registry.get(name);
  if (existing) {
    if (existing.type !== type) {
      throw new Error(`Metric ${name} already registered with type ${existing.type}, can't re-register as ${type}`);
    }
    return existing;
  }
  const m: Metric = { name, help, type, values: new Map() };
  registry.set(name, m);
  return m;
}

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map(k => `${k}=${labels[k]}`).join(',');
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function incrementCounter(name: string, help: string, labels: Labels = {}, by = 1): void {
  const m = register(name, help, 'counter');
  const key = labelKey(labels);
  const existing = m.values.get(key);
  if (existing) {
    existing.value += by;
  } else {
    m.values.set(key, { labels: { ...labels }, value: by });
  }
}

export function setGauge(name: string, help: string, value: number, labels: Labels = {}): void {
  const m = register(name, help, 'gauge');
  const key = labelKey(labels);
  m.values.set(key, { labels: { ...labels }, value });
}

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const m of registry.values()) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    if (m.values.size === 0) {
      /* Emit a zero sample with no labels so scrapers see the metric
       * exists. Without this, a counter that's never been incremented
       * would not appear in output, breaking dashboards that expect
       * the series. */
      lines.push(`${m.name} 0`);
      continue;
    }
    for (const { labels, value } of m.values.values()) {
      const labelKeys = Object.keys(labels).sort();
      if (labelKeys.length === 0) {
        lines.push(`${m.name} ${value}`);
      } else {
        const labelStr = labelKeys
          .map(k => `${k}="${escapeLabelValue(labels[k])}"`)
          .join(',');
        lines.push(`${m.name}{${labelStr}} ${value}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

/* Pre-register the wallet's counters at startup so they show up as
 * zero before they're first hit. Lets dashboards detect "no logins"
 * vs. "metric missing" correctly. */
export function initMetrics(): void {
  register('soupwallet_auth_login_total', 'Total POST /v1/auth/login requests', 'counter');
  register('soupwallet_auth_login_success_total', 'Successful logins', 'counter');
  register('soupwallet_auth_login_failure_total', 'Failed logins', 'counter');
  register('soupwallet_auth_rate_limit_hits_total', 'Times an IP hit /login or /reset rate limit', 'counter');
  register('soupwallet_http_5xx_total', 'Total HTTP responses with status 5xx', 'counter');
  register('soupwallet_process_start_time_seconds', 'Unix epoch seconds when this process started', 'gauge');
  setGauge('soupwallet_process_start_time_seconds', 'Unix epoch seconds when this process started', Math.floor(Date.now() / 1000));
}
