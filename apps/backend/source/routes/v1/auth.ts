import express from 'express';
import { CommonRoutesConfig } from '../../shared/routes.config.js';
import { AuthController } from '../../controllers/auth.js';
import { API_VERSION } from '../../shared/consts.js';
import { loginRateLimiter, passwordResetRateLimiter } from '../../shared/auth-rate-limit.js';

const AUTH_ROUTE = '/auth';

export class AuthRoutes extends CommonRoutesConfig {
  constructor(app: express.Application) {
    super(app, 'Auth Routes');
  }

  configureRoutes() {
    const authController = new AuthController();
    this.app.route(API_VERSION + AUTH_ROUTE + '/logout/').get(authController.userLogout);
    /* Login + reset gated by per-IP rate limit. See auth-rate-limit.ts
     * for posture (5/15min on login, 3/hour on reset). Successful logins
     * skip the count so legitimate operators aren't punished. */
    this.app
      .route(API_VERSION + AUTH_ROUTE + '/login/')
      .post(loginRateLimiter, authController.userLogin);
    this.app
      .route(API_VERSION + AUTH_ROUTE + '/reset/')
      .post(passwordResetRateLimiter, authController.resetPassword);
    this.app
      .route(API_VERSION + AUTH_ROUTE + '/isauthenticated/')
      .post(authController.isUserAuthenticated);
    return this.app;
  }
}
