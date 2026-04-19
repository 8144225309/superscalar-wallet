import { Request, Response, NextFunction } from 'express';
import handleError from '../shared/error-handler.js';
import { RendezvousSettingsService } from '../service/rendezvous-settings.service.js';
import { RendezvousSettings } from '../models/rendezvous-settings.type.js';
import { logger } from '../shared/logger.js';

export class RendezvousController {
  private settingsService: RendezvousSettingsService;

  constructor(settingsService: RendezvousSettingsService) {
    this.settingsService = settingsService;
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
}
