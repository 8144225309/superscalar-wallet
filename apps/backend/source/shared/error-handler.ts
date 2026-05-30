import { Request, Response, NextFunction } from 'express';
import {
  APIError,
  BaseError,
  BitcoindError,
  GRPCError,
  LightningError,
  ValidationError,
} from '../models/errors.js';
import { HttpStatusCode } from './consts.js';
import { logger } from './logger.js';
import { incrementCounter } from './metrics.js';

/**
 * Error Handler — express terminal error middleware.
 *
 * What it does
 *   Last-resort express error middleware. Normalizes any error type
 *   into a uniform { code, message, route } response and increments
 *   the http_errors_total counter (labeled by route + status) so
 *   /v1/shared/metrics surfaces error rates.
 *
 * Inputs (any of):
 *   - BaseError / APIError / BitcoindError / LightningError /
 *     ValidationError / GRPCError — first-party error classes
 *   - Anything string- or object-shaped — best-effort serialized
 *
 * Output contract
 *   - Logs via winston.error(message, route, stack)
 *   - Sends `res.status(error.code || 500).json({ ... })`
 *
 * Side effects
 *   - Increments `http_errors_total{route,status}` (metrics.ts)
 *   - Never throws — the caller (express) cannot recover otherwise.
 *
 * Wiring
 *   Mounted last in source/server.ts after all routers via
 *   `app.use(handleError)`.
 */
function handleError(
  error: BaseError | APIError | BitcoindError | LightningError | ValidationError | GRPCError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next?: NextFunction,
) {
  const route = req.url || '';
  const message = error.message
    ? error.message
    : typeof error === 'object'
      ? JSON.stringify(error)
      : typeof error === 'string'
        ? error
        : 'Unknown Error!';
  logger.error(message, route, error.stack);
  const status = error.code || HttpStatusCode.INTERNAL_SERVER;
  if (status >= 500) {
    incrementCounter('soupwallet_http_5xx_total', 'Total HTTP responses with status 5xx', {
      status: String(status),
    });
  }
  return res.status(status).json(message);
}

export default handleError;
