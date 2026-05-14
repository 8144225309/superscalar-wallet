import express from 'express';
import { CommonRoutesConfig } from '../../shared/routes.config.js';
import { AuthController } from '../../controllers/auth.js';
import { RendezvousController } from '../../controllers/rendezvous.js';
import { RendezvousSettingsService } from '../../service/rendezvous-settings.service.js';
import { LspNostrIdentityService } from '../../service/lsp-nostr-identity.service.js';
import { VouchPublisherService } from '../../service/vouch-publisher.service.js';
import { API_VERSION } from '../../shared/consts.js';

const RENDEZVOUS_ROOT_ROUTE = '/rendezvous';

export class RendezvousRoutes extends CommonRoutesConfig {
  private settingsService: RendezvousSettingsService;
  private identityService: LspNostrIdentityService;
  private vouchPublisher: VouchPublisherService;

  constructor(
    app: express.Application,
    settingsService: RendezvousSettingsService,
    identityService: LspNostrIdentityService,
    vouchPublisher: VouchPublisherService,
  ) {
    super(app, 'Rendezvous Routes');
    this.settingsService = settingsService;
    this.identityService = identityService;
    this.vouchPublisher = vouchPublisher;
  }

  configureRoutes() {
    const authController = new AuthController();
    const ctrl = new RendezvousController(
      this.settingsService,
      this.identityService,
      this.vouchPublisher,
    );

    // GET / PUT /v1/rendezvous/settings
    this.app
      .route(API_VERSION + RENDEZVOUS_ROOT_ROUTE + '/settings')
      .get(authController.isUserAuthenticated, ctrl.getSettings)
      .put(authController.isUserAuthenticated, ctrl.putSettings);

    // POST /v1/rendezvous/settings/reset
    this.app
      .route(API_VERSION + RENDEZVOUS_ROOT_ROUTE + '/settings/reset')
      .post(authController.isUserAuthenticated, ctrl.resetSettings);

    // GET /v1/rendezvous/lsp-identity
    this.app
      .route(API_VERSION + RENDEZVOUS_ROOT_ROUTE + '/lsp-identity')
      .get(authController.isUserAuthenticated, ctrl.getLspIdentity);

    // POST /v1/rendezvous/prepare-vouch-event
    this.app
      .route(API_VERSION + RENDEZVOUS_ROOT_ROUTE + '/prepare-vouch-event')
      .post(authController.isUserAuthenticated, ctrl.prepareVouchEvent);

    return this.app;
  }
}
