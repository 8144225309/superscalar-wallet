import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import bodyParser from 'body-parser';
import cors from 'cors';
import csurf from 'csurf';
import cookieParser from 'cookie-parser';
import expressWinston from 'express-winston';

import { logger, expressLogConfiguration } from './shared/logger.js';
import { CommonRoutesConfig } from './shared/routes.config.js';
import { LightningRoutes } from './routes/v1/lightning.js';
import { SharedRoutes } from './routes/v1/shared.js';
import { AuthRoutes } from './routes/v1/auth.js';
import { NodesRoutes } from './routes/v1/nodes.js';
import { RendezvousRoutes } from './routes/v1/rendezvous.js';
import { APIError } from './models/errors.js';
import { APP_CONSTANTS, Environment, HttpStatusCode } from './shared/consts.js';
import handleError from './shared/error-handler.js';
import { NodeManager } from './service/node-manager.service.js';
import { RendezvousSettingsService } from './service/rendezvous-settings.service.js';
import { LspNostrIdentityService } from './service/lsp-nostr-identity.service.js';
import { VouchPublisherService } from './service/vouch-publisher.service.js';

const directoryName = dirname(fileURLToPath(import.meta.url));
const routes: Array<CommonRoutesConfig> = [];

export const app: express.Application = express();
export const server: http.Server = http.createServer(app);

const APP_PORT = normalizePort(process.env.APP_PORT || '2103');
const APP_HOST = process.env.APP_HOST || 'localhost';
const APP_PROTOCOL = process.env.APP_PROTOCOL || 'http';

export function normalizePort(val: string) {
  const port = parseInt(val, 10);
  if (isNaN(port)) {
    return val;
  }
  if (port >= 0) {
    return port;
  }
  return false;
}

app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: false, limit: '25mb' }));
app.set('trust proxy', true);
app.use(cookieParser());
app.use(csurf({ cookie: true }) as unknown as express.RequestHandler);
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache');
  /* CSP: the soup-rendezvous browse + advertise flows need outbound
   * WebSocket connections to user-configured Nostr relays
   * (wss://nos.lol, wss://relay.damus.io, etc.) and the rendezvous
   * settings panel may eventually need HTTPS fetches to coordinator
   * info endpoints. `connect-src 'self' wss: https:` permits both
   * without hardcoding any specific relay set (which is operator-
   * configurable per network). default-src remains 'self' so script,
   * style, image, etc. loads stay locked to the wallet's own origin.
   *
   * style-src 'unsafe-inline' is required because react-perfect-scrollbar
   * (used app-wide via Channels/AccountEvents/FactoryList/ConnectList scroll
   * containers) injects <style> tags at runtime. The strict policy blocked
   * these in CSP-strict browsers (Dashboard / #158 repro). XSS surface
   * remains low because script-src is still 'self'.
   *
   * frame-src 'none' / frame-ancestors 'none': we never embed external
   * frames and we never want to be embedded ourselves (clickjacking
   * defense complements X-Frame-Options: DENY below).
   *
   * object-src 'none': no Flash, PDF, applet plugins.
   *
   * base-uri 'self' / form-action 'self': locks down two often-exploited
   * vectors. We never need to set <base> nor submit forms cross-origin. */
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' wss: https:",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ') + ';',
  );
  /* Defense-in-depth headers. helmet-equivalent posture without the dep. */
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  /* Permissions-Policy: explicitly deny browser features the wallet
   * does not use. Reduces blast radius if XSS lands a payload. */
  res.setHeader(
    'Permissions-Policy',
    [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  );
  /* HSTS only when production AND https — issuing HSTS over http or
   * in dev locks browsers into a broken state if the operator later
   * switches schemes. */
  if (process.env.NODE_ENV === 'production' && APP_PROTOCOL === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  next();
});

const corsOptions = {
  methods: 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  origin:
    APP_CONSTANTS.APP_MODE === Environment.PRODUCTION
      ? `${APP_PROTOCOL}://${APP_HOST}:${APP_PORT}`
      : `${APP_PROTOCOL}://localhost:4300`,
  credentials: true,
  allowedHeaders: 'Content-Type, X-XSRF-TOKEN, XSRF-TOKEN',
};
app.use(cors(corsOptions));

app.use(expressWinston.logger(expressLogConfiguration));
app.use(expressWinston.errorLogger(expressLogConfiguration));

export const throwApiError = (err: any) => {
  switch (err.code) {
    case 'EACCES':
      return new APIError(
        HttpStatusCode.ACCESS_DENIED,
        `${APP_PROTOCOL}://${APP_HOST}:${APP_PORT} requires elevated privileges`,
      );
    case 'EADDRINUSE':
      return new APIError(
        HttpStatusCode.ADDR_IN_USE,
        `${APP_PROTOCOL}://${APP_HOST}:${APP_PORT} is already in use`,
      );
    case 'ECONNREFUSED':
      return new APIError(HttpStatusCode.UNAUTHORIZED, 'Server is down/locked');
    case 'EBADCSRFTOKEN':
      return new APIError(HttpStatusCode.BAD_CSRF_TOKEN, 'Invalid CSRF token. Form tempered.');
    default:
      return new APIError(HttpStatusCode.BAD_REQUEST, err?.message || err);
  }
};

async function startServer() {
  try {
    const nodeManager = new NodeManager();
    await nodeManager.initialize();

    const rendezvousSettingsService = new RendezvousSettingsService();
    rendezvousSettingsService.load(); // materialize defaults file on first boot

    const lspNostrIdentityService = new LspNostrIdentityService();
    lspNostrIdentityService.load(); // generate-or-load on first boot

    const vouchPublisherService = new VouchPublisherService(
      lspNostrIdentityService,
      nodeManager,
      rendezvousSettingsService,
    );

    const authRoutes = new AuthRoutes(app);
    const sharedRoutes = new SharedRoutes(app, nodeManager);
    const lightningRoutes = new LightningRoutes(app, nodeManager);
    const nodesRoutes = new NodesRoutes(app, nodeManager);
    const rendezvousRoutes = new RendezvousRoutes(
      app,
      rendezvousSettingsService,
      lspNostrIdentityService,
      vouchPublisherService,
    );

    authRoutes.configureRoutes();
    sharedRoutes.configureRoutes();
    lightningRoutes.configureRoutes();
    nodesRoutes.configureRoutes();
    rendezvousRoutes.configureRoutes();

    routes.push(authRoutes, sharedRoutes, lightningRoutes, nodesRoutes, rendezvousRoutes);

    // serve frontend
    app.use('/', express.static(join(directoryName, '..', '..', 'frontend', 'build')));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((req: express.Request, res: express.Response, next: any) => {
      res.sendFile(join(directoryName, '..', '..', 'frontend', 'build', 'index.html'));
    });

    // Global error handler for requests
    app.use((err: any, req: express.Request, res: express.Response, next: any) => {
      return handleError(throwApiError(err), req, res, next);
    });

    server.on('error', (err: any) => {
      if (err.code) {
        logger.error('On Server Error: ', err);
      } else {
        logger.error('On Server Error: ', throwApiError(err));
      }
      process.exit(1);
    });

    server.on('listening', () =>
      logger.warn(`Server running at ${APP_PROTOCOL}://${APP_HOST}:${APP_PORT}`),
    );

    server.listen({ port: APP_PORT, host: APP_HOST });
  } catch (err: any) {
    if (err.code) {
      logger.error('Server Startup Error:', err);
    } else {
      logger.error('Server Startup Error:', throwApiError(err));
    }
    process.exit(1);
  }
}

startServer();

process.on('uncaughtException', err => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});
