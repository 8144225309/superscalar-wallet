import rateLimit from 'express-rate-limit';
import { logger } from './logger.js';

/* Login brute-force defense.
 *
 * Mainnet posture: 5 failed attempts inside a rolling 15-minute window
 * triggers a 15-minute lockout for that source IP. The window is per-IP
 * and resets after the cooldown — so a real operator who fat-fingers
 * their password 5 times in a row gets a brief timeout, not a permanent
 * lockout. An attacker against a single account gets ~20 attempts/hour
 * which is too slow to brute-force any non-trivial password.
 *
 * The limiter is applied ONLY to /v1/auth/login. Other auth endpoints
 * (/logout, /reset, /isauthenticated) are not rate-limited the same way:
 *   - /logout: idempotent, no credential exposure
 *   - /reset: requires the current password to succeed, so it's already
 *     gated; also has its own much-stricter limit applied here
 *   - /isauthenticated: just a cookie check, no credential surface
 *
 * The limiter uses the in-memory store, so a server restart clears the
 * lockout state. For multi-instance deployments behind a load balancer,
 * replace MemoryStore with a Redis or Memcached store via the
 * express-rate-limit `store` option. */

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 5,                  // 5 attempts per window per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error:
      'Too many login attempts from this IP. Try again in 15 minutes.',
  },
  /* Skip the limit for successful logins so a legitimate operator
   * isn't punished for entering the right password on their 5th try. */
  skipSuccessfulRequests: true,
  handler: (req, res, next, options) => {
    logger.warn(
      `Auth rate limit hit: ip=${req.ip} ua="${req.get('user-agent') || ''}"`,
    );
    res.status(options.statusCode).json(options.message);
  },
});

/* Stricter limit on /reset because password-change should rarely happen
 * and an unexpected burst signals automation. */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,                  // 3 reset attempts per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again later.' },
  handler: (req, res, next, options) => {
    logger.warn(`Password reset rate limit hit: ip=${req.ip}`);
    res.status(options.statusCode).json(options.message);
  },
});
