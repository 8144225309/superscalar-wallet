import axios from 'axios';
import * as fs from 'fs';
import { Request, Response, NextFunction } from 'express';

import { APP_CONSTANTS, DEFAULT_CONFIG, FIAT_RATE_API, HttpStatusCode } from '../shared/consts.js';
import { logger } from '../shared/logger.js';
import handleError from '../shared/error-handler.js';
import { APIError } from '../models/errors.js';
import { addServerConfig, setEnvVariables } from '../shared/utils.js';
import { ShowRunes } from '../models/showrunes.type.js';
import { NodeManager } from '../service/node-manager.service.js';
import { renderMetrics } from '../shared/metrics.js';

const CONFIG_EXPORT_KIND = 'soupwallet-config';
const CONFIG_EXPORT_VERSION = 1;
/* Keys that are unsafe or pointless to export. Secrets (password) must
 * never leave the server; transient runtime state (isLoading/error)
 * has no meaning outside the process; mode flags (singleSignOn) are
 * deployment-environment concerns and shouldn't be carried across hosts. */
const NON_PORTABLE_CONFIG_KEYS = ['password', 'isLoading', 'error', 'singleSignOn'] as const;

export class SharedController {
  private nodeManager: NodeManager;

  constructor(nodeManager: NodeManager) {
    this.nodeManager = nodeManager;
  }

  getApplicationSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Getting Application Settings from ' + APP_CONSTANTS.APP_CONFIG_FILE);
      if (!fs.existsSync(APP_CONSTANTS.APP_CONFIG_FILE)) {
        logger.warn(
          `Config file ${APP_CONSTANTS.APP_CONFIG_FILE} not found. Creating default config.`,
        );
        fs.writeFileSync(
          APP_CONSTANTS.APP_CONFIG_FILE,
          JSON.stringify(DEFAULT_CONFIG, null, 2),
          'utf-8',
        );
      }
      let config = {
        uiConfig: JSON.parse(fs.readFileSync(APP_CONSTANTS.APP_CONFIG_FILE, 'utf-8')),
      };
      delete config.uiConfig.password;
      delete config.uiConfig.isLoading;
      delete config.uiConfig.error;
      delete config.uiConfig.singleSignOn;
      config = addServerConfig(config);
      res.status(200).json(config);
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  exportConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Exporting wallet config');
      if (!fs.existsSync(APP_CONSTANTS.APP_CONFIG_FILE)) {
        return handleError(
          new APIError(HttpStatusCode.NOT_FOUND, 'No config to export'),
          req,
          res,
          next,
        );
      }
      const raw = JSON.parse(fs.readFileSync(APP_CONSTANTS.APP_CONFIG_FILE, 'utf-8'));
      const portable: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if ((NON_PORTABLE_CONFIG_KEYS as readonly string[]).includes(k)) continue;
        portable[k] = v;
      }
      const envelope = {
        kind: CONFIG_EXPORT_KIND,
        version: CONFIG_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: process.env.APP_VERSION || 'unknown',
        config: portable,
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="soupwallet-config-${envelope.exportedAt.replace(/[:.]/g, '-')}.json"`,
      );
      res.status(200).send(JSON.stringify(envelope, null, 2));
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  importConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Importing wallet config');
      const env = req.body?.envelope;
      if (!env || typeof env !== 'object') {
        return handleError(
          new APIError(HttpStatusCode.BAD_REQUEST, 'Missing envelope in request body'),
          req,
          res,
          next,
        );
      }
      if (env.kind !== CONFIG_EXPORT_KIND) {
        return handleError(
          new APIError(HttpStatusCode.BAD_REQUEST, `Unknown export kind: ${env.kind}`),
          req,
          res,
          next,
        );
      }
      if (typeof env.version !== 'number' || env.version > CONFIG_EXPORT_VERSION) {
        return handleError(
          new APIError(
            HttpStatusCode.BAD_REQUEST,
            `Unsupported export version: ${env.version} (this build supports up to v${CONFIG_EXPORT_VERSION})`,
          ),
          req,
          res,
          next,
        );
      }
      if (!env.config || typeof env.config !== 'object') {
        return handleError(
          new APIError(HttpStatusCode.BAD_REQUEST, 'Envelope missing config object'),
          req,
          res,
          next,
        );
      }
      const current = fs.existsSync(APP_CONSTANTS.APP_CONFIG_FILE)
        ? JSON.parse(fs.readFileSync(APP_CONSTANTS.APP_CONFIG_FILE, 'utf-8'))
        : { ...DEFAULT_CONFIG };
      /* Merge incoming config OVER current, but never let import overwrite
       * non-portable keys (password hash, transient state). This preserves
       * operator login after a restore. */
      const merged: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(env.config)) {
        if ((NON_PORTABLE_CONFIG_KEYS as readonly string[]).includes(k)) continue;
        merged[k] = v;
      }
      fs.writeFileSync(
        APP_CONSTANTS.APP_CONFIG_FILE,
        JSON.stringify(merged, null, 2),
        'utf-8',
      );
      logger.info(
        `Wallet config imported (kind=${env.kind} v=${env.version} from ${env.exportedAt})`,
      );
      res.status(201).json({ message: 'Config imported', importedKeys: Object.keys(env.config).filter(k => !(NON_PORTABLE_CONFIG_KEYS as readonly string[]).includes(k)) });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  setApplicationSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Updating Application Settings: ' + JSON.stringify(req.body));
      const config = JSON.parse(fs.readFileSync(APP_CONSTANTS.APP_CONFIG_FILE, 'utf-8'));
      req.body.uiConfig.password = config.password; // Before saving, add password in the config received from frontend
      fs.writeFileSync(
        APP_CONSTANTS.APP_CONFIG_FILE,
        JSON.stringify(req.body.uiConfig, null, 2),
        'utf-8',
      );
      res.status(201).json({ message: 'Application Settings Updated Successfully' });
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  getWalletConnectSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Getting Connection Settings');
      setEnvVariables();
      res.status(200).json(APP_CONSTANTS);
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  getMetrics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.status(200).send(renderMetrics());
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };

  getFiatRate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Getting Fiat Rate for: ' + req.params.fiatCurrency);
      logger.info('Fiat URL: ' + FIAT_RATE_API + req.params.fiatCurrency);
      return axios
        .get(FIAT_RATE_API + req.params.fiatCurrency)
        .then((response: any) => {
          logger.info('Fiat Response: ' + JSON.stringify(response?.data));
          if (response.data?.bitcoin) {
            const bitcoinValues = Object.values(response.data.bitcoin);
            const rate = bitcoinValues[0];
            if (rate === undefined) {
              return handleError(
                new APIError(HttpStatusCode.NOT_FOUND, 'Price value not found'),
                req,
                res,
                next,
              );
            }
            return res.status(200).json({ rate });
          }
        })
        .catch(err => {
          logger.error('Fiat Error Response: ' + JSON.stringify(err));
          res.status(200).json({ rate: 0 });
        });
    } catch (error: any) {
      logger.error('Error from Fiat Rate: ' + JSON.stringify(error));
      res.status(200).json({ rate: 0 });
    }
  };

  saveInvoiceRune = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Saving Invoice Rune');
      const clnService = this.nodeManager.getActiveService();
      const showRunes: ShowRunes = await clnService.call('showrunes', []);
      const invoiceRune = showRunes.runes.find(
        rune =>
          rune.restrictions.some(restriction =>
            restriction.alternatives.some(alternative => alternative.value === 'invoice'),
          ) &&
          rune.restrictions.some(restriction =>
            restriction.alternatives.some(alternative => alternative.value === 'listinvoices'),
          ),
      );
      if (invoiceRune && fs.existsSync(APP_CONSTANTS.LIGHTNING_VARS_FILE)) {
        const invoiceRuneString = `INVOICE_RUNE="${invoiceRune.rune}"\n`;
        fs.appendFileSync(APP_CONSTANTS.LIGHTNING_VARS_FILE, invoiceRuneString, 'utf-8');
        res.status(201).send();
      } else {
        throw new Error('Invoice rune not found or .commando-env does not exist.');
      }
    } catch (error: any) {
      handleError(error, req, res, next);
    }
  };
}
