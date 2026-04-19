import express from 'express';
import { CommonRoutesConfig } from '../../shared/routes.config.js';
import { AuthController } from '../../controllers/auth.js';
import { RendezvousController } from '../../controllers/rendezvous.js';
import { RendezvousSettingsService } from '../../service/rendezvous-settings.service.js';
import { API_VERSION } from '../../shared/consts.js';

const RENDEZVOUS_ROOT_ROUTE = '/rendezvous';

export class RendezvousRoutes extends CommonRoutesConfig {
  private settingsService: RendezvousSettingsService;

  constructor(app: express.Application, settingsService: RendezvousSettingsService) {
    super(app, 'Rendezvous Routes');
    this.settingsService = settingsService;
  }

  configureRoutes() {
    const authController = new AuthController();
    const ctrl = new RendezvousController(this.settingsService);

    // GET /v1/rendezvous/settings
    this.app
      .route(API_VERSION + RENDEZVOUS_ROOT_ROUTE + '/settings')
      .get(authController.isUserAuthenticated, ctrl.getSettings)
      .put(authController.isUserAuthenticated, ctrl.putSettings);

    // POST /v1/rendezvous/settings/reset
    this.app
      .route(API_VERSION + RENDEZVOUS_ROOT_ROUTE + '/settings/reset')
      .post(authController.isUserAuthenticated, ctrl.resetSettings);

    return this.app;
  }
}
