import { Request, Response, NextFunction } from 'express';
import handleError from '../shared/error-handler.js';
import { RendezvousSettingsService } from '../service/rendezvous-settings.service.js';
import { LspNostrIdentityService } from '../service/lsp-nostr-identity.service.js';
import { VouchPublisherService } from '../service/vouch-publisher.service.js';
import { RendezvousSettings } from '../models/rendezvous-settings.type.js';
import { PrepareVouchEventRequest } from '../models/vouch.type.js';
import { logger } from '../shared/logger.js';

const VALID_NETWORKS = new Set(['bitcoin', 'signet', 'testnet4']);

export class RendezvousController {
  private settingsService: RendezvousSettingsService;
  private identityService: LspNostrIdentityService;
  private vouchPublisher: VouchPublisherService;

  constructor(
    settingsService: RendezvousSettingsService,
    identityService: LspNostrIdentityService,
    vouchPublisher: VouchPublisherService,
  ) {
    this.settingsService = settingsService;
    this.identityService = identityService;
    this.vouchPublisher = vouchPublisher;
  }

  getSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = this.settingsService.load();
      res.status(200).json({ settings });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  putSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const next_: RendezvousSettings = req.body?.settings;
      if (!next_ || typeof next_ !== 'object') {
        return res.status(400).json({ error: 'settings object is required in request body' });
      }
      logger.info('Updating rendezvous settings');
      const saved = this.settingsService.replace(next_);
      res.status(200).json({ settings: saved });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  resetSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Resetting rendezvous settings to defaults (preserving custom additions)');
      const settings = this.settingsService.reset();
      res.status(200).json({ settings });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  /**
   * Read-only view of the LSP's Nostr identity so the wallet UI can
   * display the host npub (e.g., "advertising as npub1xyz..." next to
   * the Host Factory advertise toggle).
   */
  getLspIdentity = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        pubkeyHex: this.identityService.getPubkeyHex(),
        npub: this.identityService.getNpub(),
      });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  /**
   * Prepare a kind-4 proof_multi DM to the coordinator. Does not
   * publish — returns the signed event for the frontend to push to
   * relays via its existing SimplePool.
   */
  prepareVouchEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Partial<PrepareVouchEventRequest>;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'request body must be an object' });
      }
      if (!body.network || !VALID_NETWORKS.has(body.network)) {
        return res
          .status(400)
          .json({ error: 'network must be one of: bitcoin, signet, testnet4' });
      }
      if (!body.lnNodeId || typeof body.lnNodeId !== 'string') {
        return res.status(400).json({ error: 'lnNodeId (hex string) is required' });
      }
      const out = await this.vouchPublisher.prepareVouchEvent({
        network: body.network,
        lnNodeId: body.lnNodeId,
      });
      res.status(200).json(out);
    } catch (error: any) {
      logger.error('prepareVouchEvent failed: ' + (error.message || error));
      handleError(error, req, res, next);
    }
  };
}
