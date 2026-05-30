import { LogLevel, LOG_LEVEL } from '../utilities/constants';

/**
 * Logger Service — UI-side level-gated console logger.
 *
 * What it provides
 *   `ConsoleLogger` (and the singleton `logger` default export) that
 *   wraps `console.{info,warn,error}` with a compile-time level gate
 *   from `LOG_LEVEL` (in utilities/constants.ts). Levels below the
 *   configured threshold become NO_OPs so production builds don't
 *   spam the browser console.
 *
 * Why a thin wrapper
 *   The wallet UI emits noisy debug-style logs during ceremonies,
 *   RPC roundtrips, and SSE reconnects. A thin gate keeps the calls
 *   in source (good for debugging) while suppressing them in
 *   shipped builds. ALSO: writing through this wrapper instead of
 *   raw console.* keeps the "no log noise in prod" lint rule simple
 *   (a single allowlisted import).
 *
 * Public API
 *   - `Logger`: minimal interface (info / warn / error)
 *   - `ConsoleLogger`: the implementation
 *   - default export: a process-wide singleton instance
 */
export interface LogFn {
  (message?: any, ...optionalParams: any[]): void;
}

export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const NO_OP: LogFn = () => {};

export class ConsoleLogger implements Logger {
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;

  constructor(options?: { level? : LogLevel }) {
    const { level } = options || {};

    this.error = console.error.bind(console);

    if (level === 'error') {
      this.warn = NO_OP;
      this.info = NO_OP;

      return;
    }
    
    this.warn = console.warn.bind(console);

    if (level === 'warn') {
      this.info = NO_OP;

      return;
    }

    this.info = console.log.bind(console);
  }
}

const logger = new ConsoleLogger({ level: LOG_LEVEL });

export default logger;
