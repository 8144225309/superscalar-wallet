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
