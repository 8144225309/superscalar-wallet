import jwt from 'jsonwebtoken';
import * as fs from 'fs';
import { Request, Response, NextFunction } from 'express';

import { APP_CONSTANTS, HttpStatusCode, SECRET_KEY } from '../shared/consts.js';
import { logger } from '../shared/logger.js';
import handleError from '../shared/error-handler.js';
import { verifyPassword, isAuthenticated, isValidPassword } from '../shared/utils.js';
import { AuthError } from '../models/errors.js';
import { incrementCounter } from '../shared/metrics.js';
import { appendAudit } from '../shared/audit-log.js';

/* Cookie security: when running in production (NODE_ENV=production), require
 * HTTPS for the token cookie. Dev/regtest stays http-friendly. The httpOnly
 * flag is always on so client-side JS can't read the token. */
const cookieFlags = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
};

/* Password strength gate for set/reset. The frontend pre-hashes the
 * password before sending (sha256 — see app config flow), so we can't
 * inspect length/charset of the user's actual plaintext from here. To
 * still enforce a strength floor, the frontend should call this same
 * helper before hashing. The server-side check below only verifies that
 * the hash being stored isn't trivially malformed (empty / wrong length).
 * Real strength enforcement happens client-side in the password-set UI. */
function isValidHashFormat(hash: unknown): boolean {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash);
}

export class AuthController {
  userLogin = async (req: Request, res: Response, next: NextFunction) => {
    logger.info('Logging in');
    incrementCounter('soupwallet_auth_login_total', 'Total POST /v1/auth/login requests');
    try {
      const vpRes = verifyPassword(req.body.password);
      if (vpRes === true) {
        const token = jwt.sign({ userID: SECRET_KEY }, SECRET_KEY);
        // Expire the token in a day
        res.cookie('token', token, { ...cookieFlags, maxAge: 3600000 * 24 });
        incrementCounter('soupwallet_auth_login_success_total', 'Successful logins');
        appendAudit('login_success', req);
        return res.status(201).json({ isAuthenticated: true, isValidPassword: isValidPassword() });
      } else {
        incrementCounter('soupwallet_auth_login_failure_total', 'Failed logins');
        appendAudit('login_failure', req);
        const err = new AuthError(HttpStatusCode.UNAUTHORIZED, vpRes);
        handleError(err, req, res, next);
      }
    } catch (error: any) {
      incrementCounter('soupwallet_auth_login_failure_total', 'Failed logins');
      appendAudit('login_failure', req, { exception: true });
      handleError(error, req, res, next);
    }
  };

  userLogout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Logging out');
      res.clearCookie('token');
      appendAudit('logout', req);
      res.status(201).json({ isAuthenticated: false, isValidPassword: isValidPassword() });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Resetting password');
      const isValid = req.body.isValid;
      const currPassword = req.body.currPassword;
      const newPassword = req.body.newPassword;
      /* Server-side floor: reject if the new password hash isn't a
       * valid 64-char hex sha256. The frontend pre-hashes plaintext,
       * so anything not matching this shape is a malformed request
       * (and would be impossible to verify on subsequent login). */
      if (!isValidHashFormat(newPassword)) {
        const err = new AuthError(HttpStatusCode.INVALID_DATA, 'New password is malformed.');
        return handleError(err, req, res, next);
      }
      if (fs.existsSync(APP_CONSTANTS.APP_CONFIG_FILE)) {
        try {
          const config = JSON.parse(fs.readFileSync(APP_CONSTANTS.APP_CONFIG_FILE, 'utf-8'));
          if (config.password === currPassword || !isValid) {
            try {
              config.password = newPassword;
              try {
                fs.writeFileSync(
                  APP_CONSTANTS.APP_CONFIG_FILE,
                  JSON.stringify(config, null, 2),
                  'utf-8',
                );
                const token = jwt.sign({ userID: SECRET_KEY }, SECRET_KEY);
                /* Fix prior bug: this used `maxAge: 3600 * 24 * 7` which is
                 * 604800 *milliseconds* (≈10 min) — wildly shorter than the
                 * stated "7-day" intent. Match the login cookie (24h) until
                 * a deliberate refresh story is shipped. */
                res.cookie('token', token, { ...cookieFlags, maxAge: 3600000 * 24 });
                appendAudit('password_reset', req);
                res.status(201).json({ isAuthenticated: true, isValidPassword: isValidPassword() });
              } catch (error: any) {
                handleError(error, req, res, next);
              }
            } catch (error: any) {
              handleError(error, req, res, next);
            }
          } else {
            return new AuthError(HttpStatusCode.UNAUTHORIZED, 'Incorrect current password');
          }
        } catch (error: any) {
          handleError(error, req, res, next);
        }
      } else {
        throw new AuthError(HttpStatusCode.UNAUTHORIZED, 'Config file does not exist');
      }
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  isUserAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uaRes = isAuthenticated(req.cookies.token);
      if (req.body?.returnResponse || false) {
        // Frontend is asking if user is authenticated or not
        if (APP_CONSTANTS.APP_SINGLE_SIGN_ON === 'true') {
          return res.status(201).json({ isAuthenticated: true, isValidPassword: true });
        } else {
          const vpRes = isValidPassword();
          if (uaRes === true) {
            if (vpRes === true) {
              return res.status(201).json({ isAuthenticated: true, isValidPassword: true });
            } else {
              return res.status(201).json({ isAuthenticated: true, isValidPassword: vpRes });
            }
          } else {
            return res.status(201).json({ isAuthenticated: false, isValidPassword: vpRes });
          }
        }
      } else {
        // Backend APIs are asking if user is authenticated or not
        if (uaRes === true || APP_CONSTANTS.APP_SINGLE_SIGN_ON === 'true') {
          return next();
        } else {
          return res.status(401).json({ error: 'Unauthorized user' });
        }
      }
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };
}
